import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed } from '../../fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

/**
 * Единственный кейс, который на новом API невоспроизводим: DML-шаг на
 * переиспользуемом read-билдере. У `orm.select()` нет шагов записи —
 * `update`/`delete`/`insert` самостоятельные входы со своим билдером,
 * поэтому «обновить через базу и не испортить её» там нечего проверять.
 *
 * Пока `single()` публичен, поведение закреплено тут; когда легаси-surface
 * уйдёт — файл удаляется вместе с ним.
 */
describe('clone: DML на переиспользуемой базе (легаси single())', () => {
  it('update() works on a snapshot; builder stays reusable', async () => {
    const base = h.orm.single(UserModel);
    const u1 = await base
      .update({ age: 31 })
      .where((u) => u.name.eq('Alice'))
      .go();
    const u2 = await base
      .update({ age: 26 })
      .where((u) => u.name.eq('Bob'))
      .go();
    expect(u1[0].age).toBe(31);
    expect(u2[0].age).toBe(26);
    expect(base.sqb.operation).toBe('select');
    expect(await base.go()).toHaveLength(3);
  });
});
