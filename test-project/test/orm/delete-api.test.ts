import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import {
  User as UserModel,
  Post as PostModel,
  Comment as CommentModel,
} from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed, type SeedData } from '../fixtures';

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
 * Снести всё, что ссылается на User: комментарии И посты.
 *
 * Не обход каскада: в model DSL referential-действий нет вообще —
 * `ReferenceFieldBuilder` не имеет `onDelete()`, а `expectedForeignKeys()`
 * (sql-pg/src/diff/types.ts) хардкодит `ON DELETE NO ACTION`. Каскадные
 * `ON DELETE CASCADE` достижимы только через ручной `applyDiff`, минуя DSL.
 * Поэтому FK честно блокирует удаление родителя, и тест обязан удалять
 * детей первыми — именно это поведение он и фиксирует.
 *
 * Порядок важен: `comment` ссылается и на `post`, и на `user`, поэтому
 * comments сносятся раньше постов.
 */
async function clearDependents(): Promise<void> {
  await h.orm.delete(CommentModel).go();
  await h.orm.delete(PostModel).go();
}

/** Только комментарии — когда цель удаления сами посты. */
async function clearComments(): Promise<void> {
  await h.orm.delete(CommentModel).go();
}

describe('delete API: entry point', () => {
  it('delete() exposes only DML steps, no set() and no select steps', () => {
    const d = h.orm.delete(UserModel);
    expect(typeof d.where).toBe('function');
    expect(typeof d.returning).toBe('function');
    expect(typeof d.go).toBe('function');
    // set() принадлежит update — у DELETE нет данных для записи.
    // @ts-expect-error set() не существует на delete-API
    expect(d.set).toBeUndefined();
    // @ts-expect-error order() недоступен в DELETE
    expect(d.order).toBeUndefined();
    // @ts-expect-error limit() недоступен в DELETE
    expect(d.limit).toBeUndefined();
    // @ts-expect-error include() недоступен в DELETE
    expect(d.include).toBeUndefined();
    // @ts-expect-error first() недоступен в DELETE
    expect(d.first).toBeUndefined();
    // @ts-expect-error fields() — это проекция чтения
    expect(d.fields).toBeUndefined();
    // @ts-expect-error count() — терминал чтения
    expect(d.count).toBeUndefined();
  });

  it('delete() is absent from select()', () => {
    // @ts-expect-error delete() не существует на select-API
    expect(h.orm.select(UserModel).delete).toBeUndefined();
  });

  it('update() and delete() are separate entries', () => {
    expect(h.orm.update(UserModel)).not.toBe(h.orm.delete(UserModel));
  });
});

describe('delete API: where + go', () => {
  it('where().go() deletes only matching rows', async () => {
    await clearDependents();
    const removed = await h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Bob'))
      .go();
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ name: 'Bob' });

    const left = await h.orm.select(UserModel).go();
    expect(left.map((u) => u.name).sort()).toEqual(['Alice', 'Carol']);
  });

  it('deleted row is really gone from the table', async () => {
    await clearDependents();
    await h.orm.delete(UserModel).where((u) => u.name.eq('Carol')).go();
    const stillThere = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Carol'))
      .go();
    expect(stillThere).toEqual([]);
    // Из трёх засеянных пользователей удалён один — остаются Alice и Bob.
    // (clearDependents сносит только посты и комментарии, не пользователей.)
    expect(await h.orm.select(UserModel).count().go()).toBe(2);
  });

  it('where() with no match deletes nothing', async () => {
    const removed = await h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Nobody'))
      .go();
    expect(removed).toEqual([]);
    expect(await h.orm.select(UserModel).count().go()).toBe(3);
  });

  it('where() is optional — without it every row is deleted', async () => {
    // Продуктовое решение, общее с UPDATE: фильтр не обязателен.
    await clearComments();
    const removed = await h.orm.delete(PostModel).go();
    expect(removed).toHaveLength(3);
    expect(await h.orm.select(PostModel).count().go()).toBe(0);
  });

  it('where() accepts a sql fragment', async () => {
    await clearComments();
    const removed = await h.orm
      .delete(PostModel)
      .where((p) => p.views.gt(5))
      .returning((p) => [p.title])
      .go();
    expect(removed).toEqual([{ title: 'Hello Postgres' }]);
  });
});

describe('delete API: returning', () => {
  it('returning() projects only the selected columns', async () => {
    await clearDependents();
    const removed = await h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Alice'))
      .returning((u) => [u.id])
      .go();
    expect(removed).toEqual([{ id: seed.alice.id }]);
  });

  it('returning() with .as() uses the alias as key', async () => {
    await clearDependents();
    const removed = await h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Alice'))
      .returning((u) => [u.name.as('who')])
      .go();
    expect(removed).toEqual([{ who: 'Alice' }]);
  });

  it('returning() works without where()', async () => {
    await clearDependents();
    const removed = await h.orm
      .delete(UserModel)
      .returning((u) => [u.id])
      .go();
    expect(removed).toHaveLength(3);
  });
});

describe('delete API: sql preview', () => {
  it('sql() renders a readable preview of DELETE', () => {
    const text = h.orm.delete(UserModel).where((u) => u.name.eq('Alice')).sql();
    expect(text).toContain('DELETE FROM "user"');
    expect(text).toContain('WHERE');
  });
});

describe('delete API: builder reuse', () => {
  it('go() does not mutate the builder', async () => {
    await clearDependents();
    const base = h.orm.delete(UserModel).where((u) => u.active.eq(true));
    // active: alice + carol. Первый go() удалит их.
    const first = await base.go();
    expect(first).toHaveLength(2);
    // Второй go() на том же билдере удалит уже нечего — условие не накопилось.
    const second = await base.go();
    expect(second).toEqual([]);
  });
});

describe('delete API: referential integrity', () => {
  it('FK blocks deleting a parent while children reference it', async () => {
    // Контракт БД, а не ORM: FK всегда ON DELETE NO ACTION — в model DSL
    // нет ни onDelete(), ни cascade(). Проверка фиксирует границу: ORM
    // не обходит целостность, а отдаёт ошибку Postgres.
    await expect(
      h.orm.delete(UserModel).where((u) => u.name.eq('Alice')).go(),
    ).rejects.toThrow(/foreign key/i);
  });

  it('the same delete succeeds once children are gone', async () => {
    await clearDependents();
    await expect(
      h.orm.delete(UserModel).where((u) => u.name.eq('Alice')).go(),
    ).resolves.toHaveLength(1);
  });
});