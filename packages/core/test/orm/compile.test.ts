import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppCore } from '../../src/core/app-core';
import { OrmManager } from '../../src/orm/orm';
import { QuerySlots } from '../../src/orm/query-slots';
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

describe('compile() — type-level', () => {
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
    const b = orm.single(User).select((u) => [u.id, u.name]);
    type R = Awaited<ReturnType<typeof b.go>>;
    const c = b.compile<{ tenantId: number }>();
    const e: Equal<typeof c, CompiledQuery<{ tenantId: number }, R>> = true;
    expect(e).toBe(true);
  });

  it('first() — TResult миррорит go() (first → single | undefined)', () => {
    const bf = orm
      .single(User)
      .select((u) => [u.id])
      .first();
    const cf = bf.compile();
    const e: Equal<
      typeof cf,
      CompiledQuery<Record<string, never>, { id: number } | undefined>
    > = true;
    expect(e).toBe(true);
  });

  it('typed compile(S) — TSlots получается из ToDef<S>, TResult не зависит от S', () => {
    const S = new QuerySlots(User).push((u) => [u.tenantId]);
    const b = orm
      .single(User)
      .select((u) => [u.id])
      .where((u) => u.tenantId.eq(S.slot('tenantId')));
    type R = Awaited<ReturnType<typeof b.go>>;
    const c = b.compile(S);
    const e: Equal<typeof c, CompiledQuery<{ tenantId: number }, R>> = true;
    expect(e).toBe(true);
  });

  it('QuerySlots другого класса модели — compile-time ошибка (S invariant)', () => {
    const S = new QuerySlots(Other).push((o) => [o.otherId]);
    const b = orm.single(User);
    // @ts-expect-error — QuerySlots<Other> не легален для single(User)
    b.compile(S);
  });

  it('compile<T>() не накладывает ограничений на слот-мапу: _slots = T', () => {
    const b = orm.single(User);
    const c = b.compile<{ arbitrary: boolean; tenantId: number }>();
    type Slots = typeof c extends CompiledQuery<infer S, any> ? S : never;
    const e: Equal<Slots, { arbitrary: boolean; tenantId: number }> = true;
    expect(e).toBe(true);
  });
});

describe('compile() — runtime', () => {
  let app: AppCore;
  let adapter: ReturnType<typeof makeMockAdapter>;
  let orm: OrmManager;

  beforeEach(() => {
    Model.clear();
    app = new AppCore();
    app.register([User]);
    adapter = makeMockAdapter();
    orm = makeOrm(app, adapter);
  });

  afterEach(() => Model.clear());

  it('передаёт toSql КЛОН sqb с материализованными selects; compiled.sqb — тот же клон', () => {
    const b = orm.single(User).select((u) => [u.id, u.name]);
    adapter.toSql.mockReturnValue({
      text: 'SELECT "id", "name" FROM "users"',
      values: [],
    });

    const c = b.compile<Record<string, never>>();

    expect(adapter.toSql).toHaveBeenCalledTimes(1);
    const got = adapter.toSql.mock.calls[0][0] as ReadonlySqb;
    expect(got).not.toBe(b.sqb); // не сам билдер, а клон
    expect(got).toBe(c.sqb); // snap-контекст для reshape
    expect(got.selects).toHaveLength(2); // selects материализованы
  });

  it('плоский compile() — текст/значения/слоты проходят насквозь, маркеры целы', () => {
    const marker = new SlotMarker('tenantId');
    const declared: SlotDefinition[] = [{ name: 'tenantId', index: 1 }];
    adapter.toSql.mockReturnValue({
      text: 'SELECT 1 FROM "users" WHERE "tenantId" = $1',
      values: [marker],
      slotOrder: declared,
    });

    const c = orm.single(User).compile<{ tenantId: number }>();

    expect(c.text).toBe('SELECT 1 FROM "users" WHERE "tenantId" = $1');
    expect(c.values).toStrictEqual([marker]);
    expect(c.slotOrder).toBe(declared);
    expect(c.sqb).toBe(adapter.toSql.mock.calls[0][0]);
  });

  it('single-флаг: false для many, true после first()', () => {
    adapter.toSql.mockReturnValue({ text: 'SELECT 1', values: [] });
    expect(orm.single(User).compile().single).toBe(false);
    expect(orm.single(User).first().compile().single).toBe(true);
  });

  it('slotOrder не задан адаптером → []', () => {
    adapter.toSql.mockReturnValue({ text: 'SELECT 1', values: [] });
    const c = orm.single(User).compile();
    expect(c.slotOrder).toStrictEqual([]);
  });

  it('слот-массив через .as("ids") в IN: маркер в values, имя в slotOrder', () => {
    const S = new QuerySlots(User).push((u) => [u.id.array.as('ids')]);
    adapter.toSql.mockReturnValue({
      text: 'SELECT 1 FROM "users" WHERE "id" IN ($2)',
      values: [new SlotMarker('ids')],
      slotOrder: [{ name: 'ids', index: 2 }],
    });
    const c = orm
      .single(User)
      .where((u) => u.id.in(S.slot('ids')))
      .compile(S);
    expect(c.slotOrder).toStrictEqual([{ name: 'ids', index: 2 }]);
    expect(c.values).toStrictEqual([new SlotMarker('ids')]);
  });

  it('typed compile(S) с валидными именами — не бросает', () => {
    const S = new QuerySlots(User).push((u) => [u.tenantId]);
    adapter.toSql.mockReturnValue({
      text: 'SELECT 1',
      values: [],
      slotOrder: [{ name: 'tenantId', index: 1 }],
    });
    expect(() =>
      orm
        .single(User)
        .where((u) => u.tenantId.eq(S.slot('tenantId')))
        .compile(S),
    ).not.toThrow();
  });

  it('typed compile(S): имя из slotOrder вне объявленных → throw', () => {
    const S = new QuerySlots(User).push((u) => [u.tenantId]);
    adapter.toSql.mockReturnValue({
      text: 'SELECT 1',
      values: [],
      slotOrder: [{ name: 'nope', index: 1 }],
    });
    const b = orm.single(User).where((u) => u.tenantId.eq(S.slot('tenantId')));
    expect(() => b.compile(S)).toThrow(/not declared.*nope/);
  });

  it('нет адаптера → throw в compile', () => {
    const appNo = new AppCore();
    appNo.register([User]);
    const noAdapter = new OrmManager(appNo);
    expect(() => noAdapter.single(User).compile()).toThrow(
      /No adapter configured; cannot compile SQL/,
    );
  });

  it('clone-паттерн: go-ветка и compile-ветка от одной фабрики в отдельных клонах', async () => {
    const S = new QuerySlots(User).push((u) => [
      u.tenantId,
      u.id.array.as('ids'),
    ]);
    const q = () =>
      orm
        .single(User)
        .select((u) => [u.id, u.name])
        .clone();
    adapter.execute.mockResolvedValue([{ id: 1, name: 'a' }]);

    const r1 = await q()
      .where((u) => u.name.eq('a'))
      .go();

    adapter.toSql.mockReturnValue({
      text: 'WHERE "tenantId" = $1 AND "id" IN ($2)',
      values: [new SlotMarker('tenantId'), new SlotMarker('ids')],
      slotOrder: [
        { name: 'tenantId', index: 1 },
        { name: 'ids', index: 2 },
      ],
    });
    const c2 = q()
      .where((u) => u.tenantId.eq(S.slot('tenantId')))
      .where((u) => u.id.in(S.slot('ids')))
      .compile(S);

    expect(r1).toStrictEqual([{ id: 1, name: 'a' }]);
    expect(c2.values[0]).toBeInstanceOf(SlotMarker);
    expect(c2.values[1]).toBeInstanceOf(SlotMarker);
    expect(c2.slotOrder.map((s) => s.name)).toStrictEqual(['tenantId', 'ids']);
    // go и compile используют независимые клоны: execute 1 раз, toSql 1 раз
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(adapter.toSql).toHaveBeenCalledTimes(1);
    // новое ответвление от фабрики по-прежнему чистое (только select из фабрики)
    expect(q().sqb.selects).toHaveLength(2);
    expect(q().sqb.wheres.elements).toHaveLength(0);
  });
});
