import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AppCore } from '../../src/core/app-core';
import { OrmManager } from '../../src/orm/orm';
import { fillCompiled } from '../../src/orm/compiled-query';
import { QuerySlots } from '../../src/orm/query-slots';
import { SlotMarker } from '../../src/orm/slot';
import { Model } from '../../src/model/index';
import f from '../../src/model/fields';
import { makeMockAdapter } from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

class User extends Model {
  id = f.pk;
  name = f.string;
  tenantId = f.number;
  active = f.bool;

  ['~shape']!: { id: number; name: string; tenantId: number; active: boolean };
  ['~rel']!: Record<string, unknown>;
  ['~relInfo']!: Record<string, unknown>;
}

function makeOrm(app: AppCore, adapter: ReturnType<typeof makeMockAdapter>) {
  return new OrmManager(app, adapter as unknown as SqlAdapter);
}

describe('fillCompiled — валидация и замена', () => {
  const slotOrder = [{ name: 'tenantId', index: 1 }];
  const marker = new SlotMarker('tenantId');

  it('заменяет маркер во ВСЕХ вхождениях (один слот — несколько $N)', () => {
    const compiled = {
      text: 'p1',
      values: [marker, 'x', marker, 5],
      slotOrder,
    };
    expect(fillCompiled(compiled, { tenantId: 7 })).toStrictEqual({
      text: 'p1',
      params: [7, 'x', 7, 5],
    });
  });

  it('пустые слоты и пустой input — сквозной проход', () => {
    expect(
      fillCompiled({ text: 'T', values: [1, 2], slotOrder: [] }, {}),
    ).toStrictEqual({ text: 'T', params: [1, 2] });
  });

  it('полный набор — порядок параметров по values, а не по slotOrder', () => {
    expect(
      fillCompiled(
        { text: 'T', values: [marker, 'const'], slotOrder },
        { tenantId: 9 },
      ),
    ).toStrictEqual({ text: 'T', params: [9, 'const'] });
  });

  it('недостающий ключ → throw с именами', () => {
    expect(() =>
      fillCompiled({ text: 'T', values: [marker], slotOrder }, {}),
    ).toThrow(/Missing slot value\(s\): tenantId/);
  });

  it('лишний ключ → throw с именами', () => {
    expect(() =>
      fillCompiled({ text: 'T', values: [], slotOrder: [] }, { ghost: 1 }),
    ).toThrow(/Unknown slot key\(s\): ghost/);
  });
});

describe('orm.run — тип fill', () => {
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

  it('fill типизируется ToDef-мапой слота: верный ключ ок, лишний/нехватка — ошибка', () => {
    const S = new QuerySlots(User).push((u) => [u.tenantId]);
    adapter.toSql.mockReturnValue({
      text: 'WHERE "tenantId" = $1',
      values: [new SlotMarker('tenantId')],
      slotOrder: [{ name: 'tenantId', index: 1 }],
    });
    const c = orm
      .single(User)
      .where((u) => u.tenantId.eq(S.slot('tenantId')))
      .compile(S);
    const runner = orm.run(c);
    expect(() => runner.fill({ tenantId: 7 })).not.toThrow();
    // @ts-expect-error — лишний ключ (strict-fill бросал бы и в runtime)
    if (false) runner.fill({ tenantId: 7, nope: 1 });
    // @ts-expect-error — не хватает tenantId
    if (false) runner.fill({});
  });
});

describe('orm.run / orm.raw — runtime', () => {
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

  it('run().fill().go() — adapter.raw(text, filled params) + adapter.reshape(sqb, rows)', async () => {
    const marker = new SlotMarker('tenantId');
    adapter.toSql.mockReturnValue({
      text: 'WHERE "tenantId" = $1',
      values: [marker],
      slotOrder: [{ name: 'tenantId', index: 1 }],
    });
    adapter.raw.mockResolvedValue([{ id: 1, hit: 42 }]);
    adapter.reshape.mockImplementation(
      (_sqb, rows: Record<string, unknown>[]) =>
        rows.map((r) => ({ ...r, seen: true })),
    );

    const c = orm
      .single(User)
      .where((u) => u.active.eq(true))
      .compile<{ tenantId: number }>();
    const out = await orm.run(c).fill({ tenantId: 42 }).go();

    expect(adapter.raw).toHaveBeenCalledWith('WHERE "tenantId" = $1', [42]);
    expect(adapter.reshape).toHaveBeenCalledWith(c.sqb, [{ id: 1, hit: 42 }]);
    expect(out).toStrictEqual([{ id: 1, hit: 42, seen: true }]);
  });

  it('single-режим (first()): run().fill().go() разворачивает rows[0]; пусто → undefined', async () => {
    const S2 = new QuerySlots(User).push((u) => [u.active]);
    adapter.toSql.mockReturnValue({
      text: 'WHERE "active" = $1',
      values: [new SlotMarker('active')],
      slotOrder: [{ name: 'active', index: 1 }],
    });
    adapter.raw.mockResolvedValue([{ id: 1, name: 'a' }]);
    adapter.reshape.mockImplementation(
      (_sqb, rows: Record<string, unknown>[]) => rows,
    );

    const c = orm
      .single(User)
      .where((u) => u.active.eq(S2.slot('active')))
      .first()
      .compile(S2);
    const out = await orm.run(c).fill({ active: true }).go();
    expect(adapter.raw).toHaveBeenCalledWith('WHERE "active" = $1', [true]);
    expect(out).toStrictEqual({ id: 1, name: 'a' });

    adapter.raw.mockResolvedValue([]);
    const empty = await orm.run(c).fill({ active: true }).go();
    expect(empty).toBeUndefined();
  });

  it('sql() preview: "SQL: …" + "VALUES: […]"', async () => {
    const marker = new SlotMarker('tenantId');
    adapter.toSql.mockReturnValue({
      text: 'WHERE "tenantId" = $1',
      values: [marker],
      slotOrder: [{ name: 'tenantId', index: 1 }],
    });
    const c = orm.single(User).compile<{ tenantId: number }>();
    expect(orm.run(c).fill({ tenantId: 7 }).sql()).toBe(
      'SQL: WHERE "tenantId" = $1\nVALUES: [7]',
    );
    expect(adapter.raw).not.toHaveBeenCalled();
  });

  it('run без адаптера → throw до fill', () => {
    adapter.toSql.mockReturnValue({ text: 'T', values: [], slotOrder: [] });
    const c = orm.single(User).compile<Record<string, never>>();
    const appNo = new AppCore();
    appNo.register([User]);
    const noAdapter = new OrmManager(appNo);
    expect(() => noAdapter.run(c)).toThrow(/No SQL adapter configured/);
  });

  it('raw() — сквозной вызов adapter.raw с параметрами', async () => {
    adapter.raw.mockResolvedValue([{ x: 1 }]);
    await expect(
      orm.raw<{ x: number }>('SELECT $1', [1]),
    ).resolves.toStrictEqual([{ x: 1 }]);
    expect(adapter.raw).toHaveBeenCalledWith('SELECT $1', [1]);
  });

  it('raw() без адаптера → throw', () => {
    const appNo = new AppCore();
    appNo.register([User]);
    const noAdapter = new OrmManager(appNo);
    expect(() => noAdapter.raw('SELECT 1')).toThrow(
      /No SQL adapter configured/,
    );
  });

  it('run() внутри transaction() маршрутизирует на tx-адаптер', async () => {
    const S = new QuerySlots(User).push((u) => [u.tenantId]);
    const txAdapter = {
      ...makeMockAdapter(),
      commit: vi.fn(),
      rollback: vi.fn(),
    };
    adapter.beginTransaction.mockResolvedValue(txAdapter);
    adapter.toSql.mockReturnValue({
      text: 'WHERE "tenantId" = $1',
      values: [new SlotMarker('tenantId')],
      slotOrder: [{ name: 'tenantId', index: 1 }],
    });
    txAdapter.raw.mockResolvedValue([{ id: 1 }]);

    const c = orm
      .single(User)
      .where((u) => u.tenantId.eq(S.slot('tenantId')))
      .compile(S);

    const res = await orm.transaction(async (tx) => {
      const out = await tx.run(c).fill({ tenantId: 3 }).go();
      expect(txAdapter.raw).toHaveBeenCalledWith('WHERE "tenantId" = $1', [3]);
      expect(txAdapter.reshape).toHaveBeenCalled();
      expect(adapter.raw).not.toHaveBeenCalled();
      return out;
    });

    expect(res).toStrictEqual([{ id: 1 }]);
  });
});

describe('go() vs run(compile()).fill().go() — два канала, один результат', () => {
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

  it('pipeline-go и compiled-run дают идентичные строки (значение прошивается через fill)', async () => {
    const S = new QuerySlots(User).push((u) => [u.tenantId]);

    // Адаптер работает "реально": execute = toSql → raw → reshape
    adapter.toSql.mockImplementation((sqb) => {
      const marker = (
        sqb.wheres.elements[0] as { condition: { value: unknown } }
      ).condition.value;
      return {
        text: 'WHERE "tenantId" = $1',
        values: [marker],
        slotOrder: [{ name: 'tenantId', index: 1 }],
      };
    });
    adapter.raw.mockImplementation(async (sql, params) => [
      { id: 1, name: 'a', hit: params?.[0] as number },
    ]);
    adapter.execute.mockImplementation(async (sqb) => {
      const { values } = adapter.toSql(sqb);
      const rows = await adapter.raw('WHERE "tenantId" = $1', values);
      return adapter.reshape(sqb, rows);
    });
    adapter.reshape.mockImplementation(
      (_sqb, rows: Record<string, unknown>[]) => rows,
    );

    // Канал 1 — прямой go() с литералом
    const r1 = await orm
      .single(User)
      .where((u) => u.tenantId.eq(42))
      .go();

    // Канал 2 — compile + fill(slot) + run
    const c2 = orm
      .single(User)
      .where((u) => u.tenantId.eq(S.slot('tenantId')))
      .compile(S);
    const r2 = await orm.run(c2).fill({ tenantId: 42 }).go();

    expect(r1).toStrictEqual([{ id: 1, name: 'a', hit: 42 }]);
    expect(r2).toStrictEqual(r1);
    // слот реально заменён значением (не маркером) и прошит в строку
    expect((r2[0] as unknown as { hit: number }).hit).toBe(42);
  });
});
