import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  ReadonlySqb,
  WindowSelectable,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

function sqb(overrides: Partial<ReadonlySqb>): ReadonlySqb {
  return {
    operation: 'select',
    tableContext: new Map([['u', 'users']]),
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

function windowSel(overrides: Partial<WindowSelectable>): WindowSelectable {
  return {
    kind: 'window',
    tableAlias: 'u',
    fieldName: '*',
    alias: 'w',
    func: 'row_number',
    aggregate: false,
    args: [],
    over: {
      partitionBy: [],
      orderBy: [],
      frame: null,
    },
    ...overrides,
  };
}

describe('SqlGenerator — window functions', () => {
  const gen = new TestGenerator();

  it('row_number over empty window renders OVER ()', () => {
    const q = sqb({
      selects: [windowSel({ fieldName: '*', alias: 'rn', func: 'row_number' })],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('ROW_NUMBER() OVER () AS "rn"');
  });

  it('rank with ORDER BY renders the window', () => {
    const q = sqb({
      selects: [
        windowSel({
          alias: 'rank',
          func: 'rank',
          over: {
            partitionBy: [],
            orderBy: [
              { tableAlias: 'u', fieldName: 'salary', direction: 'desc' },
            ],
            frame: null,
          },
        }),
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain(
      'RANK() OVER (ORDER BY "u"."salary" DESC) AS "rank"',
    );
  });

  it('windowed aggregate renders the DB column when the field is aliased', () => {
    const q = sqb({
      selects: [
        windowSel({
          fieldName: 'isFlagged',
          column: 'is_flagged',
          func: 'count',
          aggregate: true,
        }),
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('COUNT("u"."is_flagged") OVER () AS "w"');
  });

  it('first_value over an aliased column renders the DB column', () => {
    const q = sqb({
      selects: [
        windowSel({
          fieldName: 'isFlagged',
          column: 'is_flagged',
          func: 'first_value',
        }),
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('FIRST_VALUE("u"."is_flagged") OVER () AS "w"');
  });

  it('rank without ORDER BY throws', () => {
    const q = sqb({
      selects: [windowSel({ alias: 'rank', func: 'rank' })],
    });
    expect(() => gen.toSql(q)).toThrow(/ORDER BY/);
  });

  it('windowed aggregate renders aggregate body with OVER', () => {
    const q = sqb({
      selects: [
        windowSel({
          alias: 'total',
          func: 'sum',
          aggregate: true,
          fieldName: 'amount',
          over: {
            partitionBy: [{ tableAlias: 'u', fieldName: 'dept_id' }],
            orderBy: [],
            frame: null,
          },
        }),
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain(
      'SUM("u"."amount") OVER (PARTITION BY "u"."dept_id") AS "total"',
    );
  });

  it('count(*) over empty window', () => {
    const q = sqb({
      selects: [
        windowSel({
          alias: 'cnt',
          func: 'count',
          aggregate: true,
          fieldName: '*',
        }),
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('COUNT(*) OVER () AS "cnt"');
  });

  it('lag pushes offset and default as parameters', () => {
    const q = sqb({
      selects: [
        windowSel({
          alias: 'prev',
          func: 'lag',
          fieldName: 'price',
          args: [1, 0],
          over: {
            partitionBy: [],
            orderBy: [
              { tableAlias: 'u', fieldName: 'created_at', direction: 'asc' },
            ],
            frame: null,
          },
        }),
      ],
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain(
      'LAG("u"."price", $1, $2) OVER (ORDER BY "u"."created_at" ASC) AS "prev"',
    );
    expect(values).toEqual([1, 0]);
  });

  it('ntile renders bucket as parameter', () => {
    const q = sqb({
      selects: [windowSel({ alias: 'q', func: 'ntile', args: [4] })],
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('NTILE($1) OVER () AS "q"');
    expect(values).toEqual([4]);
  });

  it('frames: unbounded/current', () => {
    const q = sqb({
      selects: [
        windowSel({
          alias: 'rn',
          func: 'sum',
          aggregate: true,
          fieldName: 'amount',
          over: {
            partitionBy: [],
            orderBy: [],
            frame: ['unbounded', 'current'],
          },
        }),
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW');
  });

  it('frames: numeric offsets (positive preceding, negative following)', () => {
    const q = sqb({
      selects: [
        windowSel({
          alias: 'rn',
          func: 'sum',
          aggregate: true,
          fieldName: 'amount',
          over: {
            partitionBy: [],
            orderBy: [],
            frame: [2, -1],
          },
        }),
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('ROWS BETWEEN 2 PRECEDING AND 1 FOLLOWING');
  });

  it('window function without alias throws', () => {
    const q = sqb({
      selects: [windowSel({ alias: undefined, func: 'row_number' })],
    });
    expect(() => gen.toSql(q)).toThrow('Window function must have an alias');
  });

  it('grouped query: window over a grouped column is allowed', () => {
    const q = sqb({
      groupBy: ['id'],
      selects: [
        windowSel({
          alias: 'total',
          func: 'sum',
          aggregate: true,
          fieldName: 'id',
        }),
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('SUM("u"."id") OVER () AS "total"');
  });

  it('grouped query: window counting all rows (count(*) over) is allowed', () => {
    const q = sqb({
      groupBy: ['author'],
      selects: [
        windowSel({
          alias: 'n',
          func: 'count',
          aggregate: true,
          fieldName: '*',
        }),
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('COUNT(*) OVER () AS "n"');
  });

  it('grouped query: window on an ungrouped column fails fast', () => {
    const q = sqb({
      groupBy: ['author'],
      selects: [
        windowSel({
          alias: 'byAuthor',
          func: 'max',
          aggregate: true,
          fieldName: 'views',
        }),
      ],
    });
    expect(() => gen.toSql(q)).toThrow(/not in GROUP BY/);
  });

  it('grouped query: window arg (lag) on an ungrouped column fails fast', () => {
    const q = sqb({
      groupBy: ['author'],
      selects: [
        windowSel({
          alias: 'prev',
          func: 'lag',
          fieldName: 'views',
          args: [1],
          over: { partitionBy: [], orderBy: [], frame: null },
        }),
      ],
    });
    expect(() => gen.toSql(q)).toThrow(/not in GROUP BY/);
  });
});
