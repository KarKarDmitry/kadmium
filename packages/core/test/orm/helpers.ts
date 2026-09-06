import { vi, type Mock } from 'vitest';
import { KadmiumSqb } from '../../src/orm/sqb';
import type { ModelIR } from '../../src/ir/index';
import type { SqlAdapter, ReadonlySqb } from '@karkardmitry/kadmium-sql-types';

export interface MockAdapter {
  toSql: Mock<(sqb: ReadonlySqb) => { text: string; values: unknown[] }>;
  execute: Mock<(sqb: ReadonlySqb) => Promise<Record<string, unknown>[]>>;
  create: Mock<(table: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>>;
  raw: Mock<(sql: string, values: unknown[]) => Promise<Record<string, unknown>[]>>;
  ddl: SqlAdapter['ddl'];
  beginTransaction: Mock<() => Promise<{
    toSql: Mock;
    execute: Mock;
    create: Mock;
    raw: Mock;
    ddl: SqlAdapter['ddl'];
    commit: Mock;
    rollback: Mock;
    end: Mock;
  }>>;
  end: Mock<() => Promise<void>>;
}

export function makeMockAdapter(): MockAdapter {
  return {
    toSql: vi.fn().mockReturnValue({ text: 'SELECT 1', values: [] }),
    execute: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    raw: vi.fn().mockResolvedValue([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ddl: {} as any,
    beginTransaction: vi.fn().mockResolvedValue({
      toSql: vi.fn().mockReturnValue({ text: 'BEGIN', values: [] }),
      execute: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      raw: vi.fn().mockResolvedValue([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ddl: {} as any,
      commit: vi.fn(),
      rollback: vi.fn(),
      end: vi.fn(),
    }),
    end: vi.fn(),
  };
}

export function makeUserIR(): ModelIR {
  return {
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
        alias: 'name',
        tsType: 'string',
        nullable: false,
        unique: false,
        index: false,
      },
      email: {
        type: 'string',
        alias: 'email',
        tsType: 'string',
        nullable: false,
        unique: true,
        index: false,
      },
      age: {
        type: 'int',
        alias: 'age',
        tsType: 'number',
        nullable: true,
        unique: false,
        index: false,
      },
      active: {
        type: 'boolean',
        alias: 'active',
        tsType: 'boolean',
        nullable: false,
        unique: false,
        index: false,
      },
      posts: {
        type: 'ref',
        alias: 'posts',
        tsType: 'Post[]',
        nullable: true,
        unique: false,
        index: false,
        ref: 'Post',
        relation: 'one-to-many',
        foreignKey: 'author',
        sourceModel: 'Post',
      },
    },
  };
}

export function makePostIR(): ModelIR {
  return {
    name: 'Post',
    collection: 'posts',
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
      title: {
        type: 'string',
        alias: 'title',
        tsType: 'string',
        nullable: false,
        unique: false,
        index: false,
      },
      author: {
        type: 'ref',
        alias: 'author',
        tsType: 'number',
        nullable: false,
        unique: false,
        index: true,
        ref: 'User',
        relation: 'many-to-one',
        foreignKey: 'author',
      },
    },
  };
}

export function makeSqb(): KadmiumSqb {
  return new KadmiumSqb();
}
