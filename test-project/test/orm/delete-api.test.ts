import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import {
  User as UserModel,
  Post as PostModel,
  Comment as CommentModel,
  UserAccount as UserAccountModel,
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
 * Только комментарии — когда цель удаления сами посты.
 *
 * Поста с комментариями удалить нельзя: `Comment.post` объявлен с
 * `onDelete('cascade')`, поэтому комментарии уйдут вместе с постом, а
 * `returning` вернёт только строки постов. Чтобы число возвращённых строк
 * соответствовало сидам, дети сносятся заранее.
 */
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
    await h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Carol'))
      .go();
    const stillThere = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Carol'))
      .go();
    expect(stillThere).toEqual([]);
    // Из трёх засеянных пользователей удалён один — остаются Alice и Bob.
    // Каскада по постам у Carol нет, а её комментарий переживает удаление:
    // Comment.user объявлен с onDelete('set null'), а не cascade.
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
    const removed = await h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Alice'))
      .returning((u) => [u.id])
      .go();
    expect(removed).toEqual([{ id: seed.alice.id }]);
  });

  it('returning() with .as() uses the alias as key', async () => {
    const removed = await h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Alice'))
      .returning((u) => [u.name.as('who')])
      .go();
    expect(removed).toEqual([{ who: 'Alice' }]);
  });

  it('returning() works without where()', async () => {
    const removed = await h.orm
      .delete(UserModel)
      .returning((u) => [u.id])
      .go();
    expect(removed).toHaveLength(3);
  });
});

describe('delete API: sql preview', () => {
  it('sql() renders a readable preview of DELETE', () => {
    const text = h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Alice'))
      .sql();
    expect(text).toContain('DELETE FROM "user"');
    expect(text).toContain('WHERE');
  });
});

describe('delete API: builder reuse', () => {
  it('go() does not mutate the builder', async () => {
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
  /**
   * Действия объявлены в моделях: `Post.author` → cascade, `Comment.post` →
   * cascade, `Comment.user` → set null. Всё, что ниже, — поведение Postgres,
   * а не ORM: ORM отдаёт DELETE и не обходит целостность.
   */
  it('ON DELETE CASCADE takes the children of Post.author with the user', async () => {
    await h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Alice'))
      .go();

    const posts = await h.orm.select(PostModel).go();
    expect(posts.map((p) => p.title)).toEqual(['Bob Writes']);
  });

  it('the cascade is transitive — comments of the deleted posts go too', async () => {
    await h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Alice'))
      .go();

    const comments = await h.orm.select(CommentModel).go();
    // 'nice!' и 'lgtm' висели на p1/p2 автора Alice, 'meh' — на p3 Bob.
    expect(comments.map((c) => c.text)).toEqual(['meh']);
  });

  it('ON DELETE SET NULL keeps the row and clears only the FK', async () => {
    // Комментарий Алисы на посте Боба: его пост переживёт удаление Алисы,
    // поэтому SET NULL сработает на Comment.user, а не на Comment.post.
    await h.orm
      .insert(CommentModel)
      .values({
        text: 'alice on bob post',
        post: seed.p3.id,
        user: seed.alice.id,
      })
      .go();

    await h.orm
      .delete(UserModel)
      .where((u) => u.name.eq('Alice'))
      .go();

    const kept = await h.orm
      .select(CommentModel)
      .where((c) => c.text.eq('alice on bob post'))
      .go();
    expect(kept).toHaveLength(1);
    expect(kept[0].user).toBeNull();
    expect(kept[0].post).toBe(seed.p3.id);
  });

  it('NO ACTION still blocks where the DSL says nothing', async () => {
    // UserAccount.createdBy — единственный ref без onDelete(): отсутствие
    // вызова означает NO ACTION, а не «действия нет».
    await h.orm
      .insert(UserAccountModel)
      .values({
        id: randomUUID(),
        displayLabel: 'alice account',
        createdBy: seed.alice.id,
      })
      .go();

    await expect(
      h.orm
        .delete(UserModel)
        .where((u) => u.name.eq('Alice'))
        .go(),
    ).rejects.toThrow(/foreign key/i);
  });

  it('the blocking delete succeeds once the blocking child is gone', async () => {
    await h.orm
      .insert(UserAccountModel)
      .values({
        id: randomUUID(),
        displayLabel: 'alice account',
        createdBy: seed.alice.id,
      })
      .go();
    await h.orm.delete(UserAccountModel).go();

    await expect(
      h.orm
        .delete(UserModel)
        .where((u) => u.name.eq('Alice'))
        .go(),
    ).resolves.toHaveLength(1);
  });
});
