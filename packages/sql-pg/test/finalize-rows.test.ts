import { describe, it, expect } from 'vitest';
import { finalizeRows } from '../src/helpers';
import type {
  ReadonlySqb,
  SelectItem,
  IncludedRelation,
} from '@karkardmitry/kadmium-sql-types';

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
    upsertSetData: null,
    conflictTarget: null,
    doNothing: false,
    ...overrides,
  };
}

function sel(tableAlias: string, fieldName: string): SelectItem {
  return { kind: 'selectable', tableAlias, fieldName };
}

function incl(parentAlias: string, propertyName: string): IncludedRelation {
  return {
    parentAlias,
    propertyName,
    relationType: 'one-to-many',
    parentField: 'id',
    childField: 'id',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    internalSqb: { includes: [] } as any,
    targetIr: { name: 'X', collection: 'x', fields: {} },
  };
}

describe('finalizeRows — гейт reshape (isMulti)', () => {
  it('multi single-alias (isMulti, size 1) — вложено под алиас', () => {
    const rows = [{ 'u.name': 'Alice' }];
    const q = sqb({
      isMulti: true,
      tableContext: new Map([['u', 'users']]),
      selects: [sel('u', 'name')],
    });
    expect(finalizeRows(rows, q)).toEqual([{ u: { name: 'Alice' } }]);
  });

  it('multi single-alias с include — include под алиасом', () => {
    const rows = [{ 'u.id': 1, posts: [{ id: 10, title: 'A' }] }];
    const q = sqb({
      isMulti: true,
      tableContext: new Map([['u', 'users']]),
      selects: [sel('u', 'id')],
      includes: [incl('u', 'posts')],
    });
    expect(finalizeRows(rows, q)).toEqual([
      { u: { id: 1, posts: [{ id: 10, title: 'A' }] } },
    ]);
  });

  it('single (isMulti не задан), tableAlias на селектах — плоские строки', () => {
    const rows = [{ 'User.name': 'Alice' }];
    const q = sqb({
      selects: [sel('User', 'name')],
    });
    expect(finalizeRows(rows, q)).toEqual([{ 'User.name': 'Alice' }]);
  });

  it('selects null/empty у multi — строки не трогаются', () => {
    expect(
      finalizeRows([{ id: 1 }], sqb({ isMulti: true, selects: null })),
    ).toEqual([{ id: 1 }]);
    expect(
      finalizeRows(
        [{ id: 1 }],
        sqb({ isMulti: true, selects: [] as SelectItem[] }),
      ),
    ).toEqual([{ id: 1 }]);
  });

  it('не-select операции — без reshape', () => {
    const rows = [{ id: 1 }];
    const q = sqb({ operation: 'update', selects: [sel('u', 'id')] });
    expect(finalizeRows(rows, q)).toEqual([{ id: 1 }]);
  });
});
