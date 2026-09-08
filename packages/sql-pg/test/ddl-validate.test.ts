import { describe, it, expect } from 'vitest';
import {
  assertSqlIdentifier,
  assertSqlExpression,
  assertReferentialAction,
  assertDiffOpSqlSafe,
} from '../src/ddl-validate';
import type { DiffOp } from '../src/diff/types';

describe('assertSqlIdentifier', () => {
  it('accepts snake_case, camelCase, digits after first char', () => {
    expect(() => assertSqlIdentifier('users', 'table name')).not.toThrow();
    expect(() =>
      assertSqlIdentifier('registeredAt', 'column name'),
    ).not.toThrow();
    expect(() => assertSqlIdentifier('p1', 'column name')).not.toThrow();
  });

  it('rejects quotes, spaces, dots, sql fragments', () => {
    const bad = [
      'users; DROP TABLE users; --',
      'user"name"',
      'two words',
      'a.b',
      '1start',
      'name--',
    ];
    for (const b of bad) {
      expect(() => assertSqlIdentifier(b, 'table name')).toThrow();
    }
  });

  it('rejects empty and over-long identifiers', () => {
    expect(() => assertSqlIdentifier('', 'table name')).toThrow();
    expect(() => assertSqlIdentifier('a'.repeat(64), 'table name')).toThrow();
  });
});

describe('assertSqlExpression', () => {
  it('accepts valid default/type expressions', () => {
    const ok = [
      'now()',
      '0',
      '-1',
      "'active'",
      "'hello'::text",
      "nextval('users_id_seq'::regclass)",
      'CURRENT_TIMESTAMP',
      'varchar(255)',
      'timestamp without time zone',
      'ARRAY[1, 2, 3]',
      'true',
      "('{}'::jsonb)",
    ];
    for (const e of ok) {
      expect(() => assertSqlExpression(e, 'default value')).not.toThrow();
    }
  });

  it('rejects statement breakers and comments', () => {
    const bad = [
      '0; DROP TABLE users; --',
      'now()); DROP TABLE users; --',
      'now() /* x */',
      '1-- comment',
      'text; SELECT pg_sleep(10);',
    ];
    for (const b of bad) {
      expect(() => assertSqlExpression(b, 'default value')).toThrow();
    }
  });

  it('rejects unallowed characters', () => {
    expect(() => assertSqlExpression("'x' || 'y'", 'default value')).toThrow();
    expect(() =>
      assertSqlExpression('$tag$body$tag$', 'default value'),
    ).toThrow();
    expect(() => assertSqlExpression('a|b', 'default value')).toThrow();
  });

  it('rejects unbalanced parens / quotes and empty', () => {
    expect(() => assertSqlExpression('(now()', 'x')).toThrow();
    expect(() => assertSqlExpression("now(')", 'x')).toThrow();
    expect(() => assertSqlExpression('', 'x')).toThrow();
  });
});

describe('assertReferentialAction', () => {
  it('accepts the five Postgres actions', () => {
    for (const a of [
      'NO ACTION',
      'CASCADE',
      'SET NULL',
      'RESTRICT',
      'SET DEFAULT',
    ]) {
      expect(() => assertReferentialAction(a, 'ON DELETE')).not.toThrow();
    }
  });

  it('rejects arbitrary SQL', () => {
    expect(() =>
      assertReferentialAction('CASCADE; DROP TABLE users', 'ON DELETE'),
    ).toThrow();
    expect(() => assertReferentialAction('FOO', 'ON UPDATE')).toThrow();
  });
});

describe('assertDiffOpSqlSafe', () => {
  const safeTable: DiffOp = {
    type: 'create-table',
    table: 'users',
    columns: [
      {
        name: 'id',
        tableName: 'users',
        dataType: 'serial',
        isNullable: false,
        defaultValue: null,
        isPrimary: true,
        isUnique: true,
      },
    ],
  };

  it('accepts a safe create-table op', () => {
    expect(() => assertDiffOpSqlSafe(safeTable)).not.toThrow();
  });

  it('rejects a malicious column type', () => {
    const op: DiffOp = {
      ...safeTable,
      columns: [
        {
          ...safeTable.columns[0]!,
          dataType: 'text; DROP TABLE users; --',
        },
      ],
    };
    expect(() => assertDiffOpSqlSafe(op)).toThrow();
  });

  it('rejects a malicious FK referential action', () => {
    const op: DiffOp = {
      type: 'add-foreign-key',
      fk: {
        name: 'fk_x',
        tableName: 'posts',
        columns: ['author'],
        refTable: 'users',
        refColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION; DROP TABLE users; --',
      },
    };
    expect(() => assertDiffOpSqlSafe(op)).toThrow();
  });
});
