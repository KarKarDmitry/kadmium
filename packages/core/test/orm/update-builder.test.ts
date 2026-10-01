import { describe, it, expect } from 'vitest';
import { UpdateQueryBuilder } from '../../src/orm/builders/update';
import { and, or } from '../../src/orm/where-expression';
import { sql } from '../../src/orm/sql-fragment';
import { makeUserIR, makeMockAdapter, type MockAdapter } from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

function userBuilder(adapter?: MockAdapter) {
  return new UpdateQueryBuilder(
    makeUserIR(),
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

describe('UpdateQueryBuilder — set', () => {
  it('объявляет operation=update в конструкторе, а не на терминале', () => {
    // Отличие от single(): там операция появлялась в момент .update(), и
    // билдер оставался 'select'. Здесь UPDATE объявлен сразу — операция нужна
    // финализатору для рендера.
    const b = userBuilder();
    expect(b.sqb.operation).toBe('update');
  });

  it('set() наполняет updateData, а терминалы читают его с клона', () => {
    const b = userBuilder();
    expect(b.sqb.updateData).toBeNull();
    b.set({ name: 'Alice' });
    expect(b.sqb.updateData).toEqual({ name: 'Alice' });
  });

  it('билдер не multi (isMulti=false)', () => {
    const b = userBuilder();
    expect(b.sqb.isMulti).toBe(false);
  });

  it('finalizer has where/go/sql', () => {
    const b = userBuilder();
    const f = b.set({ name: 'Alice' });
    expect(typeof f.where).toBe('function');
    expect(typeof f.go).toBe('function');
    expect(typeof f.sql).toBe('function');
  });

  it('finalizer go throws without adapter', async () => {
    const b = userBuilder();
    const f = b.set({ name: 'Alice' });
    await expect(f.go()).rejects.toThrow('No adapter configured');
  });

  it('where() пишет в сам билдер — в этом отличие от single()', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = userBuilder(adapter);
    b.set({ name: 'Alice' }).where((u: any) => u.id.eq(1));
    // Терминалы строятся из клона УЖЕ собранного sqb, иначе условие потерялось
    // бы. Поэтому where() мутирует билдер — ветвление только через clone().
    expect(b.sqb.wheres.elements.length).toBe(1);
    await b.go();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'update',
        wheres: expect.objectContaining({
          elements: expect.arrayContaining([expect.anything()]),
        }),
      }),
    );
  });
});

describe('UpdateQueryBuilder — update returning', () => {
  it('finalizer has returning directly and after where', () => {
    const f = userBuilder().set({ name: 'Alice' });
    expect(typeof f.returning).toBe('function');
    expect(typeof f.where((u: any) => u.id.eq(1)).returning).toBe('function');
  });

  it('returning строит проекцию на клоне — билдер остаётся чистым', () => {
    const b = userBuilder();
    b.set({ name: 'Alice' }).returning((u: any) => [u.id]);
    expect(b.sqb.selects).toBeNull();
  });

  it('returning with aggregate is executed with aggregate select', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 1, total: 2 }]);
    const b = userBuilder(adapter);
    const f = b.set({ name: 'Alice' });
    await f
      .returning((u, { agg }: any) => [u.id, agg.count('*').as('total')])
      .go();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        selects: expect.arrayContaining([
          expect.objectContaining({ kind: 'aggregate' }),
        ]),
      }),
    );
  });

  it('returning go throws without adapter', async () => {
    const f = userBuilder().set({ name: 'Alice' });
    await expect(f.returning((u: any) => [u.id]).go()).rejects.toThrow(
      'No adapter configured',
    );
  });

  it('returning go maps rows by alias', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ n: 'Alice' }]);
    const b = userBuilder(adapter);
    const f = b.set({ name: 'new' });
    const result = await f.returning((u: any) => [u.name.as('n')]).go();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'update' }),
    );
    expect(result).toEqual([{ n: 'Alice' }]);
  });

  it('returning go drops unselected fields', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 1, name: 'Alice' }]);
    const b = userBuilder(adapter);
    const f = b.set({ name: 'new' });
    const result = await f.returning((u: any) => [u.id]).go();
    expect(result).toEqual([{ id: 1 }]);
    expect('name' in result[0]).toBe(false);
  });

  it('where().returning().go() применяет where и мапит строки', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 42 }]);

    const result = await userBuilder(adapter)
      .set({ name: 'new' })
      .where((u: any) => u.id.eq(1))
      .returning((u: any) => [u.id])
      .go();

    expect(result).toEqual([{ id: 42 }]);
  });
});
