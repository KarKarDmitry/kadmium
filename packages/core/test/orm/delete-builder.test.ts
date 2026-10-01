import { describe, it, expect } from 'vitest';
import { DeleteQueryBuilder } from '../../src/orm/builders/delete';
import { and, or } from '../../src/orm/where-expression';
import { sql } from '../../src/orm/sql-fragment';
import { makeUserIR, makeMockAdapter, type MockAdapter } from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

function userBuilder(adapter?: MockAdapter) {
  return new DeleteQueryBuilder(
    makeUserIR(),
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

describe('DeleteQueryBuilder — where/go/sql', () => {
  it('объявляет operation=delete в конструкторе', () => {
    // Отличие от single(): там операция появлялась в момент .delete().
    // Здесь DELETE объявлен сразу — операция нужна финализатору.
    const b = userBuilder();
    expect(b.sqb.operation).toBe('delete');
  });

  it('where/go/sql доступны прямо на билдере — отдельного терминала нет', () => {
    const b = userBuilder();
    expect(typeof b.where).toBe('function');
    expect(typeof b.go).toBe('function');
    expect(typeof b.sql).toBe('function');
    // @ts-expect-error у DELETE нет терминала .delete(): DELETE — это и есть билдер
    expect(b.delete).toBeUndefined();
  });
});

describe('DeleteQueryBuilder — returning', () => {
  it('returning доступен прямо и после where', () => {
    const b = userBuilder();
    expect(typeof b.returning).toBe('function');
    expect(typeof b.where((u: any) => u.id.eq(1)).returning).toBe('function');
  });

  it('returning пишет проекцию в клон финализатора, не в билдер', () => {
    const b = userBuilder();
    b.returning((u: any) => [u.id]);
    expect(b.sqb.selects).toBeNull();
  });

  it('returning go мапит строки и отбрасывает невыбранные поля', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 7, name: 'Ghost' }]);
    const result = await userBuilder(adapter)
      .returning((u: any) => [u.id])
      .go();
    expect(result).toEqual([{ id: 7 }]);
  });
});
