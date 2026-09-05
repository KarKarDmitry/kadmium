import { describe, it, expect } from 'vitest';
import { Relation } from '../../src/orm/field-builders/relation';
import { makeSqb, makeUserIR, makePostIR } from './helpers';
import type { FieldIR } from '../../src/ir/index';

function makeFieldIr(overrides?: Partial<FieldIR>): FieldIR {
  return {
    type: 'ref',
    alias: 'posts',
    tsType: 'Post[]',
    nullable: true,
    unique: false,
    index: false,
    ref: 'Post',
    relation: 'many-to-one',
    foreignKey: 'author',
    ...overrides,
  } as FieldIR;
}

describe('Relation — constructor', () => {
  it('many-to-one (default)', () => {
    const sqb = makeSqb();
    const targetIr = makePostIR();
    const rel = new Relation(sqb, 'posts', targetIr, makeFieldIr());
    expect(rel.relationType).toBe('many-to-one');
    expect(rel.parentField).toBe('author');
    expect(rel.childField).toBe('id');
  });

  it('one-to-many (sourceModel set)', () => {
    const sqb = makeSqb();
    const targetIr = makePostIR();
    const fieldIr = makeFieldIr({ sourceModel: 'Post', relation: undefined });
    const rel = new Relation(sqb, 'posts', targetIr, fieldIr);
    expect(rel.relationType).toBe('one-to-many');
    expect(rel.parentField).toBe('id');
    expect(rel.childField).toBe('author');
  });

  it('one-to-one', () => {
    const sqb = makeSqb();
    const targetIr = makePostIR();
    const fieldIr = makeFieldIr({ relation: 'one-to-one' });
    const rel = new Relation(sqb, 'profile', targetIr, fieldIr);
    expect(rel.relationType).toBe('one-to-one');
    expect(rel.parentField).toBe('author');
    expect(rel.childField).toBe('id');
  });

  it('sets internalSqb with targetIr name', () => {
    const sqb = makeSqb();
    const targetIr = makePostIR();
    const rel = new Relation(sqb, 'posts', targetIr, makeFieldIr());
    expect(rel.internalSqb.tableContext.get('posts')).toBe('Post');
  });
});

describe('Relation — as()', () => {
  it('clones sqb and updates alias', () => {
    const sqb = makeSqb();
    const targetIr = makePostIR();
    const rel = new Relation(sqb, 'posts', targetIr, makeFieldIr());
    const originalSqb = rel.internalSqb;

    const renamed = rel.as('p');

    expect(rel.alias).toBe('p');
    expect(rel.internalSqb).not.toBe(originalSqb);
    expect(rel.internalSqb.tableContext.has('p')).toBe(true);
    expect(rel.internalSqb.tableContext.has('posts')).toBe(false);
  });
});

describe('Relation — where/order/limit/select', () => {
  it('where pushes condition to internalSqb', () => {
    const sqb = makeSqb();
    const rel = new Relation(sqb, 'posts', makePostIR(), makeFieldIr());
    rel.where((t: any) => t.title.eq('Hello'));
    expect(rel.internalSqb.wheres.conditions.length).toBe(1);
  });

  it('order pushes to internalSqb.orders', () => {
    const sqb = makeSqb();
    const rel = new Relation(sqb, 'posts', makePostIR(), makeFieldIr());
    rel.order((t: any) => t.title, 'desc');
    expect(rel.internalSqb.orders.length).toBe(1);
    expect(rel.internalSqb.orders[0].direction).toBe('desc');
  });

  it('limit sets internalSqb.limit', () => {
    const sqb = makeSqb();
    const rel = new Relation(sqb, 'posts', makePostIR(), makeFieldIr());
    rel.limit(5);
    expect(rel.internalSqb.limit).toBe(5);
  });

  it('select sets internalSqb.selects', () => {
    const sqb = makeSqb();
    const rel = new Relation(sqb, 'posts', makePostIR(), makeFieldIr());
    rel.select((t: any) => [t.title]);
    expect(rel.internalSqb.selects).not.toBeNull();
    expect(rel.internalSqb.selects!.length).toBe(1);
  });
});

describe('Relation — include', () => {
  it('pushes nested builder into internalSqb.includes', () => {
    const sqb = makeSqb();
    const userIr = makeUserIR();
    const rel = new Relation(sqb, 'author', userIr, makeFieldIr({ ref: 'User', foreignKey: 'id' }));
    rel.include((t: any) => [t.posts]);
    expect(rel.internalSqb.includes.length).toBe(1);
  });
});

describe('Relation — propertyName', () => {
  it('returns alias', () => {
    const sqb = makeSqb();
    const rel = new Relation(sqb, 'posts', makePostIR(), makeFieldIr());
    expect(rel.propertyName).toBe('posts');
  });

  it('returns renamed alias after as()', () => {
    const sqb = makeSqb();
    const rel = new Relation(sqb, 'posts', makePostIR(), makeFieldIr());
    rel.as('p');
    expect(rel.propertyName).toBe('p');
  });
});
