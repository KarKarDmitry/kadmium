import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppCore } from '../../src/core/app-core';
import { OrmManager } from '../../src/orm/orm';
import { QuerySlots } from '../../src/orm/query-slots';
import { slot } from '../../src/orm/slot';
import { Model } from '../../src/model/index';
import f from '../../src/model/fields';
import { makeMockAdapter } from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

class User extends Model {
  id = f.pk;
  name = f.string;
  posts = f.ref.target(Post, 'author');

  ['~shape']!: { id: number; name: string };
  ['~rel']!: { posts: Post[] };
  ['~relInfo']!: { posts: { target: Post; kind: 'one-to-many' } };
}

class Post extends Model {
  id = f.pk;
  title = f.string;
  views = f.number;
  published = f.bool;
  author = f.ref.target(User, 'posts');

  ['~shape']!: {
    id: number;
    title: string;
    views: number;
    published: boolean;
    author: number;
  };
  ['~rel']!: { author?: User };
  ['~relInfo']!: { author: { target: User; kind: 'many-to-one' } };
}

/**
 * Тип `IncludeFilterProxy`/`IncludeOrderProxy` (types/includes.d.ts):
 * колбэки where/order внутри include() должны получать типизированные
 * FilterProxy/OrderProxy целевой модели, а не `any`.
 */
describe('include: where/order колбэки типизированы (IncludeFilterProxy)', () => {
  let app: AppCore;
  let orm: OrmManager;

  beforeEach(() => {
    Model.clear();
    app = new AppCore();
    app.register([User, Post]);
    orm = new OrmManager(app, makeMockAdapter() as unknown as SqlAdapter);
  });

  afterEach(() => Model.clear());

  it('where/order/select в include() — типизированные колбэки целевой модели', () => {
    const b = orm
      .single(User)
      .select((u) => [u.id])
      .include({
        posts: {
          where: (p) => p.views.gt(0),
          order: (p) => [p.views.desc, p.title.asc],
          select: (p) => [p.title],
        },
      });
    type R = Awaited<ReturnType<typeof b.go>>;
    const e: Equal<R, { id: number; posts: { title: string }[] }[]> = true;
    expect(e).toBe(true);
  });

  it('ref-FK поле (Post.author) в include-where даёт NumberFilter: eq(1) легален', () => {
    const b = orm
      .single(Post)
      .select((p) => [p.id])
      .include({
        author: { where: (a) => a.id.eq(1) },
      });
    expect(b).toBeDefined();
  });

  it('typed-слот и flat slot() легальны в include-where (SlotMarker ⊆ BaseFilter<V>)', () => {
    const S = new QuerySlots(Post).push((p) => [p.views.as('minViews')]);
    const typed = orm.single(User).include({
      posts: { where: (p) => p.views.gt(S.slot('minViews')) },
    });
    const flat = orm.single(User).include({
      posts: { where: (p) => p.views.gt(slot('minViews')) },
    });
    expect(typed).toBeDefined();
    expect(flat).toBeDefined();
  });

  it('order-колбэк возвращает OrderDirection[]: .asc/.desc типизированы', () => {
    const b = orm.single(User).include({
      posts: {
        order: (p) => [p.title.asc, p.views.desc],
      },
    });
    expect(b).toBeDefined();
  });

  it('StringFilter в eq-число — тип-ошибка (postfix-поле title)', () => {
    // тело не выполняется: проверяется только компиляция
    const typecheck = (): void => {
      // @ts-expect-error — title: string, eq(number) запрещён
      orm.single(User).include({ posts: { where: (p) => p.title.eq(1) } });
    };
    void typecheck;
    expect(true).toBe(true);
  });

  it('NumberFilter в eq-bool — тип-ошибка', () => {
    const typecheck = (): void => {
      // @ts-expect-error — published: boolean, eq(число) запрещён
      orm.single(User).include({ posts: { where: (p) => p.published.eq(1) } });
    };
    void typecheck;
    expect(true).toBe(true);
  });

  it('FK-поле author: number — eq(string) тип-ошибка', () => {
    const typecheck = (): void => {
      // @ts-expect-error — author: number (FK), eq(string) запрещён
      orm.single(Post).include({ author: { where: (a) => a.id.eq('x') } });
    };
    void typecheck;
    expect(true).toBe(true);
  });

  it('order-колбэк с WhereCondition вместо OrderDirection[] — тип-ошибка', () => {
    const typecheck = (): void => {
      // @ts-expect-error — eq() возвращает WhereCondition, не OrderDirection
      orm.single(User).include({ posts: { order: (p) => [p.views.eq(1)] } });
    };
    void typecheck;
    expect(true).toBe(true);
  });
});
