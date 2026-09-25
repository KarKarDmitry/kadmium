import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  ReadonlySqb,
  SqlSelectItem,
  SlotDefinition,
  SelectableField,
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
    upsertSetData: null,
    conflictTarget: null,
    doNothing: false,
    ...overrides,
  };
}

function sqlItem(
  text: string,
  alias: string,
  values: unknown[] = [],
  slotOrder: SlotDefinition[] = [],
): SqlSelectItem {
  return { kind: 'sql-item', text, alias, values, slotOrder };
}

function selectable(tableAlias: string, fieldName: string): SelectableField {
  return { kind: 'selectable', tableAlias, fieldName };
}

describe('SqlGenerator — toSql: sql-item в SELECT (C2)', () => {
  const gen = new TestGenerator();

  it('рендерит фрагмент с алиасом рядом с обычными полями', () => {
    const q = sqb({
      selects: [
        selectable('User', 'id'),
        sqlItem('EXTRACT(YEAR FROM "User"."registered_at")', 'year'),
      ],
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain(
      'SELECT "User"."id" AS "id", EXTRACT(YEAR FROM "User"."registered_at") AS "year"',
    );
    expect(values).toEqual([]);
  });

  it('сдвигает локальные $N на общий paramIndex', () => {
    const q = sqb({
      selects: [
        sqlItem('LOWER($1)', 'lower_name', ['X']),
        sqlItem('COALESCE(x, $1, $2)', 'c', [5, 7]),
      ],
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('LOWER($1) AS "lower_name"');
    expect(text).toContain('COALESCE(x, $2, $3) AS "c"');
    expect(values).toEqual(['X', 5, 7]);
  });

  it('публикует slotOrder с учётом сдвига индексов', () => {
    const q = sqb({
      selects: [
        sqlItem('LOWER($1)', 'lower_name', ['X']),
        sqlItem(
          'COALESCE(x, $1, $2)',
          'c',
          [5, 'marker'],
          [{ name: 'threshold', index: 2 }],
        ),
      ],
    });
    const { text, values, slotOrder } = gen.toSql(q);
    expect(text).toContain('COALESCE(x, $2, $3) AS "c"');
    expect(values).toEqual(['X', 5, 'marker']);
    expect(slotOrder).toEqual([{ name: 'threshold', index: 3 }]);
  });

  it('фрагмент без собственных параметров не сдвигает следующих', () => {
    const q = sqb({
      selects: [
        sqlItem('EXTRACT(YEAR FROM now())', 'year'),
        sqlItem('UPPER($1)', 'upper', ['x']),
      ],
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('EXTRACT(YEAR FROM now()) AS "year"');
    expect(text).toContain('UPPER($1) AS "upper"');
    expect(values).toEqual(['x']);
  });
});
