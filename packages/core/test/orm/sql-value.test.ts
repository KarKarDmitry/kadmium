import { describe, it, expect } from 'vitest';
import { sql, SqlValue, toSqlValue } from '../../src/orm/sql-fragment';
import { SingleQueryBuilder } from '../../src/orm/builders/single';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import { makeMockAdapter, type MockAdapter, makeUserIR } from './helpers';

function builder(adapter?: MockAdapter) {
  return new SingleQueryBuilder(
    makeUserIR(),
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

describe('DML-значения по sql-фрагменту (F)', () => {
  it('SqlValue компилирует текст/параметры/слоты в конструкторе', () => {
    const v = new SqlValue(sql`"User"."age" + ${1}`);
    expect(v.kind).toBe('sql-value');
    expect(v.text).toBe('"User"."age" + $1');
    expect(v.values).toEqual([1]);
    expect(v.slotOrder).toEqual([]);
  });

  it('toSqlValue: SqlFragment → SqlValue, примитивы as-is', () => {
    expect(toSqlValue(sql`a = b`)).toBeInstanceOf(SqlValue);
    expect(toSqlValue(42)).toBe(42);
    expect(toSqlValue(null)).toBe(null);
    expect(toSqlValue('x')).toBe('x');
  });

  it('update() с фрагментом кладёт SqlValue в updateData (объект-форма)', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValueOnce([{ id: 5, age: 6 }]);
    const finalizer = builder(adapter).update({
      age: sql`"User"."age" + ${1}`,
    });
    await finalizer.go();
    const captured = adapter.execute.mock.calls[0][0] as {
      updateData: Record<string, unknown>;
    };
    expect(captured.updateData.age).toBeInstanceOf(SqlValue);
    expect((captured.updateData.age as SqlValue).text).toBe(
      '"User"."age" + $1',
    );
    expect((captured.updateData.age as SqlValue).values).toEqual([1]);
  });

  it('update() с коллбэком и proxy-рефом: `${u.age}` → "User"."age"', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValueOnce([{ id: 5, age: 6 }]);
    const finalizer = builder(adapter).update((u: any) => ({
      age: sql`${u.age} + ${1}`,
    }));
    await finalizer.go();
    const captured = adapter.execute.mock.calls[0][0] as {
      updateData: Record<string, unknown>;
    };
    expect((captured.updateData.age as SqlValue).text).toBe(
      '"User"."age" + $1',
    );
  });

  it('create() с фрагментом кладёт SqlValue в upsertData', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValueOnce([{ id: 1, active: true }]);
    const finalizer = builder(adapter).create({ active: sql`TRUE` });
    await finalizer.go();
    const captured = adapter.execute.mock.calls[0][0] as {
      upsertData: Record<string, unknown>;
    };
    expect(captured.upsertData.active).toBeInstanceOf(SqlValue);
    expect((captured.upsertData.active as SqlValue).text).toBe('TRUE');
    expect((captured.upsertData.active as SqlValue).values).toEqual([]);
  });

  it('createMany().onConflict().set() передаёт setData через adapter.createMany', async () => {
    const adapter = makeMockAdapter();
    adapter.createMany.mockResolvedValueOnce([
      { id: 1, age: 2 },
      { id: 2, age: 3 },
    ]);
    const finalizer = builder(adapter)
      .createMany([
        { id: 1, age: 2 },
        { id: 2, age: 3 },
      ])
      .onConflict((t: any) => [t.id])
      .set({ age: sql`EXCLUDED."age" + ${1}` });
    await finalizer.go();
    const [table, rows, options] = adapter.createMany.mock.calls[0] as [
      string,
      Record<string, unknown>[],
      {
        conflictTarget: string[];
        setData: Record<string, unknown>;
      },
    ];
    expect(table).toBe('users');
    expect(rows).toHaveLength(2);
    expect(options.conflictTarget).toEqual(['id']);
    expect(options.setData.age).toBeInstanceOf(SqlValue);
    expect((options.setData.age as SqlValue).text).toBe('EXCLUDED."age" + $1');
    expect((options.setData.age as SqlValue).values).toEqual([1]);
  });

  it('set() обычное значение не оборачивается в SqlValue', async () => {
    const adapter = makeMockAdapter();
    const finalizer = builder(adapter)
      .createMany([{ id: 1, age: 2 }])
      .onConflict((t: any) => [t.id])
      .set({ age: 5 });
    await finalizer.go();
    const options = adapter.createMany.mock.calls[0][2] as {
      setData: Record<string, unknown>;
    };
    expect(options.setData.age).toBe(5);
  });

  it('set() без onConflict — ошибка', () => {
    const adapter = makeMockAdapter();
    const finalizer = builder(adapter).createMany([{ id: 1, age: 2 }]);
    expect(() => finalizer.set({ age: sql`5` })).toThrow(
      'set() requires onConflict() first',
    );
  });

  it('createMany() с фрагментом-ячейкой сохраняет SqlValue в строке', async () => {
    const adapter = makeMockAdapter();
    adapter.createMany.mockResolvedValueOnce([{ id: 1, age: 0 }]);
    const finalizer = builder(adapter).createMany([
      { id: 1, age: sql`0` },
      { id: 2, age: 3 },
    ]);
    await finalizer.go();
    const rows = adapter.createMany.mock.calls[0][1] as Record<
      string,
      unknown
    >[];
    expect(rows[0].age).toBeInstanceOf(SqlValue);
    expect((rows[0].age as SqlValue).text).toBe('0');
    expect(rows[1].age).toBe(3);
  });

  it('create() ключи мапятся prop→alias, значения нормализуются', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValueOnce([{ id: 1, registeredAt: 0 }]);
    const finalizer = builder(adapter).create({ age: sql`now()` });
    await finalizer.go();
    const captured = adapter.execute.mock.calls[0][0] as {
      upsertData: Record<string, unknown>;
    };
    expect(captured.upsertData.age).toBeInstanceOf(SqlValue);
    expect((captured.upsertData.age as SqlValue).text).toBe('now()');
  });
});
