import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import {
  buildInsertSql,
  buildInsertManySql,
  buildUpsertManySql,
} from '../../src/helpers';
import type {
  ReadonlySqb,
  SqlValueFragment,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

/** DML-значение по фрагменту: precompiled-лист (как core SqlValue). */
function valFrag(
  text: string,
  values: unknown[] = [],
  slotOrder = [],
): SqlValueFragment {
  return { kind: 'sql-value', text, values, slotOrder };
}

function sqb(overrides: Partial<ReadonlySqb>): ReadonlySqb {
  return {
    operation: 'select',
    tableContext: new Map([['User', 'users']]),
    wheres: { elements: [] },
    havings: { elements: [] },
    cursor: { elements: [] },
    selects: null,
    joins: [],
    includes: [],
    orders: [],
    limit: null,
    offset: null,
    groupBy: [],
    updateData: null,
    upsertData: null,
    upsertSetData: null,
    conflictTarget: null,
    doNothing: false,
    ...overrides,
  };
}

describe('SqlGenerator — DML-выражения (F)', () => {
  const gen = new TestGenerator();

  describe('UPDATE SET', () => {
    it('фрагмент вместо параметра: текст дословно, значения сдвигаются', () => {
      const q = sqb({
        operation: 'update',
        updateData: { age: valFrag('"User"."age" + $1', [1]) },
      });
      const r = gen.toSql(q);
      expect(r.text).toContain(
        'UPDATE "users" AS "User" SET "age" = "User"."age" + $1',
      );
      expect(r.values).toEqual([1]);
    });

    it('обычное значение — как раньше: $N', () => {
      const q = sqb({
        operation: 'update',
        updateData: { active: true },
      });
      const r = gen.toSql(q);
      expect(r.text).toContain('SET "active" = $1');
      expect(r.values).toEqual([true]);
    });

    it('смесь: литерал до фрагмента с $1 → фрагмент сдвигается на $2', () => {
      const q = sqb({
        operation: 'update',
        updateData: {
          active: true,
          age: valFrag('"User"."age" + $1', [5]),
        },
      });
      const r = gen.toSql(q);
      expect(r.text).toContain('SET "active" = $1, "age" = "User"."age" + $2');
      expect(r.values).toEqual([true, 5]);
    });
  });

  describe('INSERT (single upsert)', () => {
    it('фрагмент в VALUES: now() без параметров', () => {
      const q = sqb({
        operation: 'upsert',
        upsertData: { createdAt: valFrag('now()', []) },
      });
      const r = gen.toSql(q);
      expect(r.text).toContain(
        'INSERT INTO "users" ("createdAt") VALUES (now())',
      );
      expect(r.values).toEqual([]);
    });

    it('смесь: $1 для id, выражение для created_at', () => {
      const q = sqb({
        operation: 'upsert',
        upsertData: { id: 1, createdAt: valFrag('now()', []) },
      });
      const r = gen.toSql(q);
      expect(r.text).toContain('VALUES ($1, now())');
      expect(r.values).toEqual([1]);
    });
  });

  describe('ON CONFLICT SET (upsertSetData)', () => {
    it('setMap-фрагмент: DO UPDATE SET с выражением, $N сдвигается после VALUES', () => {
      const q = sqb({
        operation: 'upsert',
        upsertData: { id: 1, views: 2 },
        conflictTarget: ['id'],
        upsertSetData: { views: valFrag('EXCLUDED."views" + $1', [1]) },
      });
      const r = gen.toSql(q);
      expect(r.text).toContain(
        'ON CONFLICT ("id") DO UPDATE SET "views" = EXCLUDED."views" + $3',
      );
      expect(r.values).toEqual([1, 2, 1]);
    });

    it('setMap-литерал: параметром после VALUES', () => {
      const q = sqb({
        operation: 'upsert',
        upsertData: { id: 1, views: 2 },
        conflictTarget: ['id'],
        upsertSetData: { views: 5 },
      });
      const r = gen.toSql(q);
      expect(r.text).toContain('ON CONFLICT ("id") DO UPDATE SET "views" = $3');
      expect(r.values).toEqual([1, 2, 5]);
    });

    it('без setMap — прежний EXCLUDED-дефолт', () => {
      const q = sqb({
        operation: 'upsert',
        upsertData: { id: 1, views: 2 },
        conflictTarget: ['id'],
      });
      const r = gen.toSql(q);
      expect(r.text).toContain('"views" = EXCLUDED."views"');
      expect(r.values).toEqual([1, 2]);
    });

    it('doNothing + setMap: DO NOTHING приоритетнее', () => {
      const q = sqb({
        operation: 'upsert',
        upsertData: { id: 1, views: 2 },
        conflictTarget: ['id'],
        doNothing: true,
        upsertSetData: { views: valFrag('EXCLUDED."views" + $1', [1]) },
      });
      const r = gen.toSql(q);
      expect(r.text).toContain('ON CONFLICT ("id") DO NOTHING');
      expect(r.text).not.toContain('DO UPDATE');
      expect(r.values).toEqual([1, 2]);
    });
  });
});

describe('DML helpers — фрагменты в ячейках (F)', () => {
  it('buildInsertSql: фрагмент в VALUES, без параметров', () => {
    const { text, values } = buildInsertSql('users', {
      createdAt: valFrag('now()', []),
    });
    expect(text).toBe(
      'INSERT INTO "users" ("createdAt") VALUES (now()) RETURNING *',
    );
    expect(values).toEqual([]);
  });

  it('buildInsertManySql: смесь фрагментов и литералов по ячейкам', () => {
    const { text, values } = buildInsertManySql('users', [
      { name: 'a', views: valFrag('0', []) },
      { name: 'b', views: 3 },
    ]);
    expect(text).toContain('VALUES ($1, 0), ($2, $3)');
    expect(values).toEqual(['a', 'b', 3]);
  });

  it('buildInsertManySql: фрагмент с параметром учитывает сдвиг строки', () => {
    const { text, values } = buildInsertManySql('users', [
      { name: 'a', bio: valFrag('"bio" || $1', ['x']) },
      { name: 'b', bio: 'plain' },
    ]);
    expect(text).toContain('VALUES ($1, "bio" || $2), ($3, $4)');
    expect(values).toEqual(['a', 'x', 'b', 'plain']);
  });

  it('buildUpsertManySql: setMap-литерал после multi-row VALUES', () => {
    const { text, values } = buildUpsertManySql(
      'users',
      [
        { name: 'a', views: 0 },
        { name: 'b', views: 1 },
      ],
      ['name'],
      false,
      { views: 5 },
    );
    expect(text).toContain('ON CONFLICT ("name") DO UPDATE SET "views" = $5');
    expect(values).toEqual(['a', 0, 'b', 1, 5]);
  });
});
