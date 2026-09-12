import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed } from '../fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
  // 6 пользователей с контролируемыми age и active: ties на age=20.
  const roster = [
    { name: 'UA', email: 'ua@test.com', age: 10, active: false },
    { name: 'UB', email: 'ub@test.com', age: 20, active: false },
    { name: 'UC', email: 'uc@test.com', age: 20, active: false },
    { name: 'UD', email: 'ud@test.com', age: 30, active: true },
    { name: 'UE', email: 'ue@test.com', age: 40, active: true },
    { name: 'UF', email: 'uf@test.com', age: 50, active: false },
  ];
  for (const u of roster) {
    await h.orm
      .single(UserModel)
      .create({
        ...u,
        registeredAt: new Date('2024-06-01T00:00:00Z'),
      })
      .go();
  }
});

afterAll(async () => {
  await h.adapter.end();
});

const ageOrder = (u: UserModel) => [u.age.asc, u.name.asc];

describe('window functions: heavy cases', () => {
  it('ntile(3) splits 6 rows into 3 even buckets', async () => {
    const rows = await h.orm
      .single(UserModel)
      .order((u) => ageOrder(u))
      .where((u) => u.name.in(['UA', 'UB', 'UC', 'UD', 'UE', 'UF']))
      .select((u, { wf }) => [
        u.name,
        u.age,
        wf
          .ntile(3)
          .orderBy(...ageOrder(u))
          .as('bucket'),
      ])
      .go();
    expect(rows.map((r) => r.bucket)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('rank() vs dense_rank() on ties', async () => {
    // Внутри окна ORDER BY только по age — UB/UC становятся равными (rank 2/2).
    const rows = await h.orm
      .single(UserModel)
      .order((u) => ageOrder(u))
      .where((u) => u.name.in(['UA', 'UB', 'UC', 'UD', 'UE', 'UF']))
      .select((u, { wf }) => [
        u.name,
        u.age,
        wf.rank().orderBy(u.age.asc).as('rank'),
        wf.denseRank().orderBy(u.age.asc).as('dense'),
      ])
      .go();
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4, 5, 6]);
    expect(rows.map((r) => r.dense)).toEqual([1, 2, 2, 3, 4, 5]);
  });

  it('percent_rank() and cume_dist() are bounded and monotonic', async () => {
    const rows = await h.orm
      .single(UserModel)
      .order((u) => ageOrder(u))
      .where((u) => u.name.in(['UA', 'UB', 'UC', 'UD', 'UE', 'UF']))
      .select((u, { wf }) => [
        u.name,
        u.age,
        wf.percentRank().orderBy(u.age.asc).as('pr'),
        wf.cumeDist().orderBy(u.age.asc).as('cd'),
      ])
      .go();
    expect(rows.map((r) => r.pr)).toEqual([0, 0.2, 0.2, 0.6, 0.8, 1]);
    expect(rows.map((r) => r.cd)).toEqual([1 / 6, 0.5, 0.5, 4 / 6, 5 / 6, 1]);
  });

  it('lag(age, 1, -1) over partition returns previous value or default', async () => {
    const rows = await h.orm
      .single(UserModel)
      .order((u) => ageOrder(u))
      .where((u) => u.name.in(['UA', 'UB', 'UC', 'UD', 'UE', 'UF']))
      .select((u, { wf }) => [
        u.name,
        u.age,
        wf
          .lag(u.age, 1, -1)
          .orderBy(...ageOrder(u))
          .as('prev'),
      ])
      .go();
    expect(rows.map((r) => r.prev)).toEqual([-1, 10, 20, 20, 30, 40]);
  });

  it('nth_value(age, 2) default frame starts at the partition + full frame', async () => {
    const rows = await h.orm
      .single(UserModel)
      .order((u) => ageOrder(u))
      .where((u) => u.name.in(['UA', 'UB', 'UC', 'UD', 'UE', 'UF']))
      .select((u, { wf }) => [
        u.name,
        u.age,
        wf.nthValue(u.age, 2).orderBy(u.age.asc).as('second'),
        wf
          .nthValue(u.age, 2)
          .orderBy(u.age.asc)
          .rowsBetween('unbounded', 'unbounded')
          .as('secondFull'),
      ])
      .go();
    // RANGE UNBOUNDED PRECEDING..CURRENT ROW: на первой строке во фрейме только 10 → null
    expect(rows.map((r) => r.second)).toEqual([null, 20, 20, 20, 20, 20]);
    // Полный фрейм: вторая строка партиции видна каждой строке
    expect(rows.map((r) => r.secondFull)).toEqual([20, 20, 20, 20, 20, 20]);
  });

  it('two-column PARTITION BY (active, age) groups correctly', async () => {
    const rows = await h.orm
      .single(UserModel)
      .order((u) => ageOrder(u))
      .where((u) => u.name.in(['UA', 'UB', 'UC', 'UD', 'UE', 'UF']))
      .select((u, { wf }) => [
        u.name,
        u.age,
        u.active,
        wf
          .rowNumber()
          .partitionBy(u.active, u.age)
          .orderBy(u.name.asc)
          .as('rn'),
      ])
      .go();
    // (false,10)=UA→1; (false,35)...: UB/UC оба (false,20)→1,2; (false,50)UF→1; (true,30)UD→1; (true,40)UE→1
    expect(rows.map((r) => r.rn)).toEqual([1, 1, 2, 1, 1, 1]);
  });

  it('ROWS BETWEEN 1 PRECEDING AND CURRENT ROW builds a sliding sum', async () => {
    const rows = await h.orm
      .single(UserModel)
      .order((u) => ageOrder(u))
      .where((u) => u.name.in(['UA', 'UB', 'UC', 'UD', 'UE', 'UF']))
      .select((u, { agg }) => [
        u.name,
        u.age,
        agg
          .sum(u.age)
          .over()
          .orderBy(...ageOrder(u))
          .rowsBetween(1, 'current')
          .as('sliding'),
      ])
      .go();
    // 10 → 10; 20 → 30; 20 → 40; 30 → 50; 40 → 70; 50 → 90
    expect(rows.map((r) => r.sliding)).toEqual([10, 30, 40, 50, 70, 90]);
  });

  it('first_value/last_value respect the window frame', async () => {
    const rows = await h.orm
      .single(UserModel)
      .order((u) => ageOrder(u))
      .where((u) => u.name.in(['UA', 'UB', 'UC', 'UD', 'UE', 'UF']))
      .select((u, { wf }) => [
        u.name,
        u.age,
        wf
          .firstValue(u.age)
          .orderBy(...ageOrder(u))
          .as('first'),
        wf
          .lastValue(u.age)
          .orderBy(...ageOrder(u))
          .as('last'),
      ])
      .go();
    expect(rows.map((r) => r.first)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(rows.map((r) => r.last)).toEqual([10, 20, 20, 30, 40, 50]);
  });

  it('count(*) OVER () in a grouped query counts groups after HAVING', async () => {
    const rows = await h.orm
      .single(UserModel)
      .select((u, { agg }) => [
        u.age,
        agg.count('*').as('cnt'),
        agg.count('*').over().as('totalGroups'),
      ])
      .groupBy((u) => [u.age])
      .having((t) => t.cnt.gt(1))
      .order((u) => [u.age.asc])
      .go();
    // Полный набор: UA(10), UB/UC(20), Bob(25), Alice/UD(30), Carol/UE(40), UF(50)
    expect(rows.map((r) => r.age)).toEqual([20, 30, 40]);
    expect(rows.map((r) => r.cnt)).toEqual([2, 2, 2]);
    // Окно вычисляется на строку результирующего набора (3 выжившие группы)
    expect(rows.map((r) => r.totalGroups)).toEqual([3, 3, 3]);
  });

  it('grouped query with a window on an ungrouped column throws', async () => {
    const q = h.orm
      .single(UserModel)
      .select((u, { agg }) => [u.age, agg.sum(u.age).over().as('sumAll')])
      .groupBy((u) => [u.active]);
    await expect(q.go()).rejects.toThrow(/GROUP BY/);
  });
});
