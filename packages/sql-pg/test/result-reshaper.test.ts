import { describe, it, expect } from 'vitest';
import { ResultReshaper } from '../src/result-reshaper';
import type {
  SelectableField,
  IncludedRelation,
} from '@karkardmitry/kadmium-sql-types';

function sel(
  tableAlias: string,
  fieldName: string,
  alias?: string,
): SelectableField {
  return {
    kind: 'selectable',
    tableAlias,
    fieldName,
    alias,
    toSql: () => `"${tableAlias}"."${fieldName}"`,
  };
}

function incl(
  parentAlias: string,
  propertyName: string,
): IncludedRelation {
  return {
    parentAlias,
    propertyName,
    relationType: 'many-to-one',
    parentField: 'id',
    childField: 'id',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    internalSqb: {} as any,
    targetIr: { name: 'X', collection: 'x', fields: {} },
  };
}

describe('ResultReshaper.reshape', () => {
  it('returns empty objects when no selects and no includes', () => {
    const flat = [{ id: 1, name: 'Alice' }];
    const result = ResultReshaper.reshape(flat, [], []);
    expect(result).toEqual([{}]);
  });

  it('nests fields under table alias', () => {
    const flat = [{ 'u.id': 1, 'u.name': 'Alice' }];
    const selects = [sel('u', 'id'), sel('u', 'name')];
    const result = ResultReshaper.reshape(flat, selects, []);
    expect(result).toEqual([{ u: { id: 1, name: 'Alice' } }]);
  });

  it('nests fields from multiple tables', () => {
    const flat = [
      { 'u.id': 1, 'u.name': 'Alice', 'p.id': 10, 'p.title': 'Post' },
    ];
    const selects = [
      sel('u', 'id'),
      sel('u', 'name'),
      sel('p', 'id'),
      sel('p', 'title'),
    ];
    const result = ResultReshaper.reshape(flat, selects, []);
    expect(result).toEqual([
      { u: { id: 1, name: 'Alice' }, p: { id: 10, title: 'Post' } },
    ]);
  });

  it('uses alias as property name when provided', () => {
    const flat = [{ author_name: 'Alice' }];
    const selects = [sel('u', 'name', 'author_name')];
    const result = ResultReshaper.reshape(flat, selects, []);
    expect(result).toEqual([{ u: { author_name: 'Alice' } }]);
  });

  it('places fields without tableAlias at root', () => {
    const flat = [{ count: 5 }];
    const selects: SelectableField[] = [
      {
        kind: 'selectable',
        tableAlias: '',
        fieldName: 'count',
        toSql: () => 'count(*)',
      },
    ];
    const result = ResultReshaper.reshape(flat, selects, []);
    expect(result).toEqual([{ count: 5 }]);
  });

  it('nests include relations under parent alias', () => {
    const flat = [
      { 'u.id': 1, author: { id: 2, name: 'Bob' } },
    ];
    const selects = [sel('u', 'id')];
    const includes = [incl('u', 'author')];
    const result = ResultReshaper.reshape(flat, selects, includes);
    expect(result).toEqual([
      { u: { id: 1, author: { id: 2, name: 'Bob' } } },
    ]);
  });

  it('handles multiple includes on the same parent', () => {
    const flat = [
      {
        'u.id': 1,
        posts: [{ id: 10, title: 'A' }],
        comments: [{ id: 20, text: 'B' }],
      },
    ];
    const selects = [sel('u', 'id')];
    const includes = [incl('u', 'posts'), incl('u', 'comments')];
    const result = ResultReshaper.reshape(flat, selects, includes);
    expect(result).toEqual([
      {
        u: {
          id: 1,
          posts: [{ id: 10, title: 'A' }],
          comments: [{ id: 20, text: 'B' }],
        },
      },
    ]);
  });

  it('skips undefined include values', () => {
    const flat = [{ 'u.id': 1 }];
    const selects = [sel('u', 'id')];
    const includes = [incl('u', 'author')];
    const result = ResultReshaper.reshape(flat, selects, includes);
    expect(result).toEqual([{ u: { id: 1 } }]);
  });

  it('handles multiple rows', () => {
    const flat = [
      { 'u.id': 1, 'u.name': 'Alice' },
      { 'u.id': 2, 'u.name': 'Bob' },
    ];
    const selects = [sel('u', 'id'), sel('u', 'name')];
    const result = ResultReshaper.reshape(flat, selects, []);
    expect(result).toEqual([
      { u: { id: 1, name: 'Alice' } },
      { u: { id: 2, name: 'Bob' } },
    ]);
  });

  it('skips aggregate selects (kind=aggregate)', () => {
    const flat = [{ 'u.id': 1, cnt: 5 }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selects: any[] = [
      sel('u', 'id'),
      { kind: 'aggregate', tableAlias: 'u', fieldName: '*', alias: 'cnt' },
    ];
    const result = ResultReshaper.reshape(flat, selects, []);
    expect(result).toEqual([{ u: { id: 1 } }]);
  });

  it('handles empty flat rows', () => {
    const result = ResultReshaper.reshape([], [sel('u', 'id')], []);
    expect(result).toEqual([]);
  });
});
