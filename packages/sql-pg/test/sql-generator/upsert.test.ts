import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type { ReadonlySqb } from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

function sqb(overrides: Partial<ReadonlySqb>): ReadonlySqb {
  return {
    operation: 'select',
    tableContext: new Map([['u', 'users']]),
    wheres: { op: 'AND', conditions: [] },
    selects: null,
    joins: [],
    includes: [],
    orders: [],
    limit: null,
    offset: null,
    groupBy: [],
    updateData: null,
    upsertData: null,
    conflictTarget: null,
    doNothing: false,
    ...overrides,
  };
}

describe('SqlGenerator — toSql: upsert', () => {
  const gen = new TestGenerator();

  it('INSERT without conflict', () => {
    const q = sqb({
      operation: 'upsert',
      upsertData: { name: 'Alice', email: 'alice@test.com' },
    });
    const { text, values } = gen.toSql(q);
    expect(text).toBe(
      'INSERT INTO "users" ("name", "email") VALUES ($1, $2) RETURNING *',
    );
    expect(values).toEqual(['Alice', 'alice@test.com']);
  });

  it('ON CONFLICT DO UPDATE', () => {
    const q = sqb({
      operation: 'upsert',
      upsertData: { name: 'Alice', email: 'alice@test.com' },
      conflictTarget: ['email'],
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('ON CONFLICT ("email") DO UPDATE SET');
    expect(text).toContain('"name" = EXCLUDED."name"');
    expect(text).not.toContain('"email" = EXCLUDED."email"');
    expect(text).toContain('RETURNING *');
    expect(values).toEqual(['Alice', 'alice@test.com']);
  });

  it('ON CONFLICT DO NOTHING', () => {
    const q = sqb({
      operation: 'upsert',
      upsertData: { name: 'Alice', email: 'alice@test.com' },
      conflictTarget: ['email'],
      doNothing: true,
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('ON CONFLICT ("email") DO NOTHING');
  });

  it('falls back to DO NOTHING when all keys are conflict targets', () => {
    const q = sqb({
      operation: 'upsert',
      upsertData: { email: 'alice@test.com' },
      conflictTarget: ['email'],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('DO NOTHING');
  });

  it('no ON CONFLICT when conflictTarget is null', () => {
    const q = sqb({
      operation: 'upsert',
      upsertData: { name: 'Alice' },
      conflictTarget: null,
    });
    const { text } = gen.toSql(q);
    expect(text).not.toContain('ON CONFLICT');
  });

  it('throws when tableContext has more than one table', () => {
    const q = sqb({
      operation: 'upsert',
      tableContext: new Map([
        ['u', 'users'],
        ['p', 'posts'],
      ]),
      upsertData: { name: 'Alice' },
    });
    expect(() => gen.toSql(q)).toThrow('UPSERT requires exactly one table');
  });

  it('throws when no upsertData', () => {
    const q = sqb({
      operation: 'upsert',
      upsertData: null,
    });
    expect(() => gen.toSql(q)).toThrow('No data provided for UPSERT');
  });
});
