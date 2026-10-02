import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { LoginSession, User as UserModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed, type SeedData } from '../../fixtures';

/**
 * `findById()` сквозным путём: IR → SQL → PostgreSQL.
 *
 * Модульные тесты билдера работают на рукописном IR и БД не касаются, а
 * IR-тесты не строят запрос. Здесь проверяется то, что невидимо ни там, ни там:
 * что признак `isPrimary` доезжает до настоящего `WHERE`, что дефолтный `id`
 * вытесняется объявленным PK, и что JOIN по связи собирается по колонке PK
 * модели, а не по литералу `'id'`.
 */
let h: Harness;
let seed: SeedData;

beforeAll(async () => {
  h = await makeHarness();
  seed = await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

/** Сессия с заданным uid — PK у неё uuid, задаётся клиентом. */
async function insertSession(uid: string, userId: number) {
  return h.orm
    .insert(LoginSession)
    .values({ uid, token: `token-${uid}`, user: userId })
    .returning((t) => [t.uid, t.token])
    .go();
}

describe('IR: первичный ключ модели', () => {
  it('у модели с нестандартным PK нет колонки id', () => {
    const ir = h.irs.get('LoginSession')!;
    expect(ir.fields.uid.isPrimary).toBe(true);
    expect(ir.fields.id).toBeUndefined();
  });

  it('колонка PK переименована через .alias()', () => {
    const ir = h.irs.get('LoginSession')!;
    expect(ir.fields.uid.alias).toBe('session_uid');
  });

  it('в IR ровно один isPrimary', () => {
    for (const name of ['LoginSession', 'User', 'UserAccount']) {
      const ir = h.irs.get(name)!;
      expect(Object.values(ir.fields).filter((f) => f.isPrimary)).toHaveLength(
        1,
      );
    }
  });

  it('у модели без явного PK остаётся дефолтный id', () => {
    const ir = h.irs.get('User')!;
    expect(ir.fields.id.isPrimary).toBe(true);
    expect(ir.fields.id.alias).toBe('id');
  });
});

describe('findById: дефолтный bigint PK', () => {
  it('находит строку по неявному id', async () => {
    const found = await h.orm
      .select(UserModel)
      .findById(seed.alice.id)
      .go();
    expect(found?.email).toBe(seed.alice.email);
  });

  it('возвращает undefined, если такой строки нет', async () => {
    const found = await h.orm.select(UserModel).findById(999999).go();
    expect(found).toBeUndefined();
  });

  it('фильтрует по колонке id', async () => {
    const found = await h.orm
      .select(UserModel)
      .findById(seed.bob.id)
      .go();
    expect(found?.name).toBe('Bob');
  });
});

describe('findById: нестандартный PK', () => {
  it('находит строку по uid — в модели нет id', async () => {
    const uid = 'a0000000-0000-4000-8000-000000000001';
    await insertSession(uid, seed.alice.id);
    const found = await h.orm.select(LoginSession).findById(uid).go();
    expect(found?.token).toBe(`token-${uid}`);
  });

  it('WHERE собирается по колонке session_uid, а не по id', async () => {
    const uid = 'a0000000-0000-4000-8000-000000000002';
    await insertSession(uid, seed.bob.id);
    const compiled = h.orm.select(LoginSession).findById(uid).compile();
    expect(compiled.text).toContain('"LoginSession"."session_uid" = $1');
    expect(compiled.text).not.toMatch(/"LoginSession"\."id"/);
    // Колонка переименована, но результат отдаётся под именем свойства.
    expect(compiled.text).toContain('"session_uid" AS "uid"');
    // Значение PK идёт первым параметром; дальше LIMIT из first().
    expect(compiled.values[0]).toBe(uid);
  });

  it('не находит чужой uid', async () => {
    const found = await h.orm
      .select(LoginSession)
      .findById('a0000000-0000-4000-8000-0000000000ff')
      .go();
    expect(found).toBeUndefined();
  });

  it('условие добавляется к уже набранным через AND', async () => {
    const uid = 'a0000000-0000-4000-8000-000000000003';
    await insertSession(uid, seed.carol.id);
    const found = await h.orm
      .select(LoginSession)
      .where((t) => t.token.eq(`token-${uid}`))
      .findById(uid)
      .go();
    expect(found?.token).toBe(`token-${uid}`);
  });
});

describe('связи по модели с нестандартным PK', () => {
  it('include собирает JOIN по колонке session_uid', async () => {
    const uid = 'a0000000-0000-4000-8000-000000000004';
    await insertSession(uid, seed.alice.id);
    const rows = await h.orm
      .select(UserModel)
      .include({ loginSessions: true })
      .where((t) => t.id.eq(seed.alice.id))
      .go();
    const sessions = rows[0].loginSessions as { uid: string }[];
    expect(sessions.map((s) => s.uid)).toContain(uid);
  });

  it('обратная связь видна со стороны LoginSession', async () => {
    const uid = 'a0000000-0000-4000-8000-000000000005';
    await insertSession(uid, seed.bob.id);
    const row = await h.orm
      .select(LoginSession)
      .findById(uid)
      .include({ user: true })
      .go();
    expect((row?.user as { email: string }).email).toBe(seed.bob.email);
  });

  it('JOIN по несуществующей колонке id не собирается — колонка из IR', async () => {
    const compiled = h.orm
      .select(UserModel)
      .include({ loginSessions: true })
      .compile();
    expect(compiled.text).toContain('session_uid');
  });
});