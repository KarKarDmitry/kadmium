import { describe, it, expect } from 'vitest';
import { buildDebugSql, mapRow } from '../../src/orm/builders/utils';
import type { ModelIR } from '../../src/ir/index';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import { makeMockAdapter, makeSqb } from './helpers';

const aliasIR: ModelIR = {
  name: 'User',
  collection: 'users',
  fields: {
    id: {
      type: 'bigint',
      alias: 'id',
      tsType: 'number',
      nullable: false,
      unique: true,
      index: false,
      isPrimary: true,
    },
    name: {
      type: 'string',
      alias: 'full_name',
      tsType: 'string',
      nullable: false,
      unique: false,
      index: false,
    },
  },
};

describe('buildDebugSql', () => {
  it('formats SQL and values from adapter.toSql', () => {
    const adapter = makeMockAdapter();
    const sqb = makeSqb();
    adapter.toSql.mockReturnValue({
      text: 'SELECT * FROM users',
      values: ['a', 1],
    });
    const sql = buildDebugSql(sqb, adapter as unknown as SqlAdapter);
    expect(sql).toBe('SQL: SELECT * FROM users\nVALUES: [a, 1]');
    expect(adapter.toSql).toHaveBeenCalledWith(sqb);
  });
});

describe('mapRow', () => {
  it('remaps column aliases to property names', () => {
    expect(mapRow(aliasIR, { id: 1, full_name: 'Ada' })).toEqual({
      id: 1,
      name: 'Ada',
    });
  });

  it('drops unknown and undefined columns', () => {
    expect(mapRow(aliasIR, { id: 1, full_name: 'Ada', nope: true })).toEqual({
      id: 1,
      name: 'Ada',
    });
    expect(mapRow(aliasIR, { id: 1 })).toEqual({ id: 1 });
  });
});
