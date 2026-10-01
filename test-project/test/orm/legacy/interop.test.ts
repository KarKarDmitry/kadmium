import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { User as UserModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed, type SeedData } from '../../fixtures';

let h: Harness;
let seed: SeedData;

beforeAll(async () => {
  h = await makeHarness();
});

afterAll(async () => {
  await h.adapter.end();
});

beforeEach(async () => {
  seed = await resetAndSeed(h);
});

/**
 * Сосуществование легаси `single()`-поверхности и новой explicit CRUD в одной
 * схеме: это обратная совместимость, а не поведение нового API, поэтому
 * проверки живут здесь, а не в `insert/`.
 *
 * Что именно фиксируется: старый и новый вход пишут в одну таблицу, читают
 * друг друга без расхождений в типах результата, а фикстура сида остаётся
 * пригодной для обоих. Пока `single()` публичен — тесты обязательны; когда
 * легаси-surface уйдёт, файл удаляется вместе с ним.
 */
describe('interop: легаси single() и новый insert API в одной схеме', () => {
  it('insert() and single().create() coexist in the same schema', async () => {
    await h.orm
      .insert(UserModel)
      .values({ name: 'NewAPI', email: 'new@test.com' })
      .go();
    await h.orm
      .single(UserModel)
      .create({ name: 'Legacy', email: 'legacy@test.com' })
      .go();

    const all = await h.orm.select(UserModel).go();
    expect(all).toHaveLength(5);
    expect(all.map((u) => u.name).sort()).toEqual([
      'Alice',
      'Bob',
      'Carol',
      'Legacy',
      'NewAPI',
    ]);
    expect(seed.alice.name).toBe('Alice');
  });

  it('insertMany() and single().createMany() coexist', async () => {
    await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'NewA', email: 'newa@test.com' },
        { name: 'NewB', email: 'newb@test.com' },
      ])
      .go();
    await h.orm
      .single(UserModel)
      .createMany([{ name: 'Legacy', email: 'legacy@test.com' }])
      .go();

    const all = await h.orm.select(UserModel).go();
    expect(all).toHaveLength(6);
    expect(seed.alice.name).toBe('Alice');
  });
});
