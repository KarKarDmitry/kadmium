import { describe, it, expect } from 'vitest';
import { InsertBuilder } from '../../src/orm/builders/insert';
import { and, or } from '../../src/orm/where-expression';
import { sql } from '../../src/orm/sql-fragment';
import { makeUserIR, makeMockAdapter, type MockAdapter } from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

function userBuilder(adapter?: MockAdapter) {
  return new InsertBuilder(
    makeUserIR(),
    undefined,
    adapter as unknown as SqlAdapter,
  );
}
describe('InsertBuilder — create', () => {
  it('go() кидает без adapter', () => {
    // В отличие от single(), где проверка жила в create(), здесь values() —
    // чистый шаг данных, а adapter нужен терминалу.
    const b = userBuilder();
    expect(() => b.values({ name: 'Alice' }).go()).toThrow(
      'No adapter configured',
    );
  });

  it('values() раскладывает ключи на алиасы и зовёт adapter.execute', async () => {
    const adapter = makeMockAdapter();
    const b = userBuilder(adapter);
    await b.values({ name: 'Alice' }).go();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'upsert',
        upsertData: { name: 'Alice' },
      }),
    );
  });
});
