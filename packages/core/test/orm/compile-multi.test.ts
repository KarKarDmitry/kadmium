import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppCore } from '../../src/core/app-core';
import { OrmManager } from '../../src/orm/orm';
import { MultiQuerySlots } from '../../src/orm/query-slots';
import { SlotMarker } from '../../src/orm/slot';
import { Model } from '../../src/model/index';
import f from '../../src/model/fields';
import { makeMockAdapter } from './helpers';
import type {
  SqlAdapter,
  ReadonlySqb,
  CompiledQuery,
  SlotDefinition,
} from '@karkardmitry/kadmium-sql-types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

class User extends Model {
  id = f.pk;
  name = f.string;
  tenantId = f.number;
  active = f.bool;

  ['~shape']!: { id: number; name: string; tenantId: number; active: boolean };
  ['~rel']!: Record<string, unknown>;
  ['~relInfo']!: Record<string, unknown>;
}

class Other extends Model {
  otherId = f.number;

  ['~shape']!: { otherId: number };
  ['~rel']!: Record<string, unknown>;
  ['~relInfo']!: Record<string, unknown>;
}

function makeOrm(app: AppCore, adapter: ReturnType<typeof makeMockAdapter>) {
  return new OrmManager(app, adapter as unknown as SqlAdapter);
}

describe('multi compile() — type-level', () => {
  let app: AppCore;
  let adapter: ReturnType<typeof makeMockAdapter>;
  let orm: OrmManager;

  beforeEach(() => {
    Model.clear();
    app = new AppCore();
    app.register([User, Other]);
    adapter = makeMockAdapter();
    orm = makeOrm(app, adapter);
  });

  afterEach(() => Model.clear());

  it('flat compile<T>() — TResult миррорит go() (many → array)', () => {
    const b = orm.query({ u: User, o: Other }).select((t) => [t.u.name]);
    type R = Awaited<ReturnType<typeof b.go>>;
    const c = b.compile<{ tenantId: number }>();
    const e: Equal<typeof c, CompiledQuery<{ tenantId: number }, R>> = true;
    expect(e).toBe(true);
  });

  it('typed compile(S) — TSlots получается из ToDef<S>, TResult не зависит от S', () => {
    const S = new MultiQuerySlots({ u: User, o: Other }).push((t) => [
      t.u.tenantId,
    ]);
    const b = orm
      .query({ u: User, o: Other })
      .where((t) => t.u.tenantId.eq(S.slot('tenantId')))
      .select((t) => [t.u.id]);
    type R = Awaited<ReturnType<typeof b.go>>;
    const c = b.compile(S);
    const e: Equal<typeof c, CompiledQuery<{ tenantId: number }, R>> = true;
    expect(e).toBe(true);
  });

  it('compile<T>() не накладывает ограничений на слот-мапу: _slots = T', () => {
    const b = orm.query({ u: User, o: Other }).select((t) => [t.u.id]);
    const c = b.compile<{ arbitrary: boolean; tenantId: number }>();
    type Slots = typeof c extends CompiledQuery<infer S, any> ? S : never;
    const e: Equal<Slots, { arbitrary: boolean; tenantId: number }> = true;
    expect(e).toBe(true);
  });

  it('MultiQuerySlots с несуществующим полем алиаса — compile-time ошибка', () => {
    const S = new MultiQuerySlots({ u: User }).push(
      // @ts-expect-error — otherId нет в модели User
      (t) => [t.u.otherId],
    );
    void S;
    expect(true).toBe(true);
  });

  it('slot() по имени вне ToDef<S> — compile-time ошибка', () => {
    const S = new MultiQuerySlots({ u: User }).push((t) => [t.u.tenantId]);
    const typecheck = (): void => {
      // @ts-expect-error — 'nope' не объявлен в push
      S.slot('nope');
    };
    void typecheck;
    expect(true).toBe(true);
  });
});

describe('multi compile() — runtime', () => {
  let app: AppCore;
  let adapter: ReturnType<typeof makeMockAdapter>;
  let orm: OrmManager;

  beforeEach(() => {
    Model.clear();
    app = new AppCore();
    app.register([User, Other]);
    adapter = makeMockAdapter();
    orm = makeOrm(app, adapter);
  });

  afterEach(() => Model.clear());

  const selectU = () =>
    orm.query({ u: User, o: Other }).select((t) => [t.u.id, t.u.name]);

  it('передаёт toSql КЛОН sqb; compiled.sqb — тот же клон', () => {
    adapter.toSql.mockReturnValue({
      text: 'SELECT "u"."id", "u"."name" FROM "users" "u"',
      values: [],
    });

    const c = selectU().compile<Record<string, never>>();

    expect(adapter.toSql).toHaveBeenCalledTimes(1);
    const got = adapter.toSql.mock.calls[0][0] as ReadonlySqb;
    expect(got).toBe(c.sqb);
    expect(got.selects).toHaveLength(2);
    expect(c.single).toBe(false);
  });

  it('плоский compile() — текст/значения/слоты проходят насквозь, маркеры целы', () => {
    const marker = new SlotMarker('tenantId');
    const declared: SlotDefinition[] = [{ name: 'tenantId', index: 1 }];
    adapter.toSql.mockReturnValue({
      text: 'SELECT 1 FROM "users" "u" WHERE "u"."tenant_id" = $1',
      values: [marker],
      slotOrder: declared,
    });

    const c = orm
      .query({ u: User, o: Other })
      .select((t) => [t.u.id])
      .compile<{ tenantId: number }>();

    expect(c.text).toBe('SELECT 1 FROM "users" "u" WHERE "u"."tenant_id" = $1');
    expect(c.values).toStrictEqual([marker]);
    expect(c.slotOrder).toBe(declared);
    expect(c.sqb).toBe(adapter.toSql.mock.calls[0][0]);
  });

  it('slotOrder не задан адаптером → []', () => {
    adapter.toSql.mockReturnValue({ text: 'SELECT 1', values: [] });
    const c = orm
      .query({ u: User, o: Other })
      .select((t) => [t.u.id])
      .compile();
    expect(c.slotOrder).toStrictEqual([]);
  });

  it('typed compile(S) с валидными именами — не бросает', () => {
    const S = new MultiQuerySlots({ u: User, o: Other }).push((t) => [
      t.u.tenantId,
    ]);
    adapter.toSql.mockReturnValue({
      text: 'SELECT 1',
      values: [],
      slotOrder: [{ name: 'tenantId', index: 1 }],
    });
    expect(() =>
      orm
        .query({ u: User, o: Other })
        .where((t) => t.u.tenantId.eq(S.slot('tenantId')))
        .select((t) => [t.u.id])
        .compile(S),
    ).not.toThrow();
  });

  it('typed compile(S): имя из slotOrder вне объявленных → throw', () => {
    const S = new MultiQuerySlots({ u: User, o: Other }).push((t) => [
      t.u.tenantId,
    ]);
    adapter.toSql.mockReturnValue({
      text: 'SELECT 1',
      values: [],
      slotOrder: [{ name: 'nope', index: 1 }],
    });
    const b = orm
      .query({ u: User, o: Other })
      .where((t) => t.u.tenantId.eq(S.slot('tenantId')))
      .select((t) => [t.u.id]);
    expect(() => b.compile(S)).toThrow(/not declared.*nope/);
  });

  it('нет адаптера → throw в compile', () => {
    const appNo = new AppCore();
    appNo.register([User, Other]);
    const noAdapter = new OrmManager(appNo);
    expect(() =>
      noAdapter
        .query({ u: User, o: Other })
        .select((t) => [t.u.id])
        .compile<Record<string, never>>(),
    ).toThrow(/No adapter configured; cannot compile SQL/);
  });

  it('clone-паттерн: go-ветка и compile-ветка независимы', async () => {
    const S = new MultiQuerySlots({ u: User, o: Other }).push((t) => [
      t.u.tenantId,
    ]);
    const q = () => orm.query({ u: User, o: Other });
    adapter.execute.mockResolvedValue([{ u: { id: 1, name: 'a' } }]);

    const r1 = await q()
      .select((t) => [t.u.id, t.u.name])
      .go();

    adapter.toSql.mockReturnValue({
      text: 'WHERE "u"."tenant_id" = $1',
      values: [new SlotMarker('tenantId')],
      slotOrder: [{ name: 'tenantId', index: 1 }],
    });
    const c2 = q()
      .where((t) => t.u.tenantId.eq(S.slot('tenantId')))
      .select((t) => [t.u.id, t.u.name])
      .compile(S);

    expect(r1).toStrictEqual([{ u: { id: 1, name: 'a' } }]);
    expect(c2.values[0]).toBeInstanceOf(SlotMarker);
    expect(c2.slotOrder.map((s) => s.name)).toStrictEqual(['tenantId']);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(adapter.toSql).toHaveBeenCalledTimes(1);
    expect(q().sqb.wheres.elements).toHaveLength(0);
  });
});
