import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  ReadonlySqb,
  OrderStep,
  IncludedRelation,
  SlotDefinition,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

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
    conflictTarget: null,
    doNothing: false,
    ...overrides,
  };
}

function orderFragment(
  text: string,
  direction: 'asc' | 'desc',
  values: unknown[] = [],
  slotOrder: SlotDefinition[] = [],
): OrderStep {
  return { kind: 'fragment', text, values, slotOrder, direction };
}

function orderColumn(field: string, direction: 'asc' | 'desc'): OrderStep {
  return { field, direction } as OrderStep;
}

describe('SqlGenerator — toSql: sql-фрагмент в ORDER BY (C2)', () => {
  const gen = new TestGenerator();

  it('рендерит фрагмент с направлением', () => {
    const q = sqb({
      orders: [orderFragment('(price * qty)', 'desc')],
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('ORDER BY (price * qty) DESC');
    expect(values).toEqual([]);
  });

  it('смесь колонки и фрагмента сохраняет порядок', () => {
    const q = sqb({
      orders: [orderColumn('name', 'asc'), orderFragment('(age * 2)', 'desc')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('ORDER BY "User"."name" ASC, (age * 2) DESC');
  });

  it('сдвигает локальные $N фрагментов по общему paramIndex', () => {
    // первый фрагмент с параметром занимает $1, второй автоматически $2
    const q = sqb({
      orders: [
        orderFragment('(a + $1)', 'asc', [1]),
        orderFragment('(b * $1)', 'desc', [5]),
      ],
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('ORDER BY (a + $1) ASC, (b * $2) DESC');
    expect(values).toEqual([1, 5]);
  });

  it('публикует slotOrder фрагмента со сдвигом', () => {
    const q = sqb({
      orders: [
        orderFragment('(c + $1)', 'asc', [1]),
        orderFragment(
          '(d + $1)',
          'asc',
          ['marker'],
          [{ name: 'threshold', index: 1 }],
        ),
      ],
    });
    const { text, values, slotOrder } = gen.toSql(q);
    expect(text).toContain('ORDER BY (c + $1) ASC, (d + $2) ASC');
    expect(values).toEqual([1, 'marker']);
    expect(slotOrder).toEqual([{ name: 'threshold', index: 2 }]);
  });

  it('фрагментный order без параметров не сдвигает следующие', () => {
    const q = sqb({
      orders: [orderFragment('(x)', 'desc'), orderColumn('name', 'asc')],
    });
    const { text, values } = gen.toSql(q);
    expect(text).toBe(
      'SELECT "User".* FROM "users" AS "User" ORDER BY (x) DESC, "User"."name" ASC',
    );
    expect(values).toEqual([]);
  });
});

describe('SqlGenerator — sql-фрагмент в ORDER BY include-подзапроса (C2)', () => {
  const gen = new TestGenerator();

  function includedRelation(
    orders: readonly OrderStep[],
    limit: number | null,
  ): IncludedRelation {
    return {
      parentAlias: 'User',
      propertyName: 'posts',
      relationType: 'one-to-many',
      parentField: 'id',
      childField: 'author',
      targetIr: { name: 'Post', collection: 'posts', fields: {} },
      internalSqb: {
        operation: 'select',
        tableContext: new Map([['Post', 'posts']]),
        wheres: { elements: [] },
        havings: { elements: [] },
        cursor: { elements: [] },
        selects: null,
        joins: [],
        includes: [],
        orders,
        limit,
        offset: null,
        groupBy: [],
        updateData: null,
        upsertData: null,
        conflictTarget: null,
        doNothing: false,
      },
    };
  }

  it('рендерит фрагмент со сдвигом параметров в LATERAL-подзапросе', () => {
    const q = sqb({
      includes: [
        includedRelation([orderFragment('(views * $1)', 'desc', [2])], 5),
      ],
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('ORDER BY (views * $1) DESC');
    expect(text).toContain('LIMIT $2');
    expect(values).toEqual([2, 5]);
  });
});
