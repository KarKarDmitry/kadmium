import { describe, it, expect } from 'vitest';
import {
  createFilterProxy,
  createSelectProxy,
  createOrderProxy,
  createRelationProxy,
} from '../../src/orm/builders/query-proxies';
import { makeSqb, makeUserIR } from './helpers';
import { Relation } from '../../src/orm/field-builders/relation';

const ir = makeUserIR();

describe('createFilterProxy', () => {
  it('valid field returns filter with correct alias/field', () => {
    const sqb = makeSqb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = createFilterProxy<any>('u', ir, sqb);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter = (proxy as any).name;
    expect(filter.alias).toBe('u');
    expect(filter.field).toBe('name');
  });

  it('invalid field throws', () => {
    const sqb = makeSqb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = createFilterProxy<any>('u', ir, sqb);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (proxy as any).nonexistent).toThrow('Field "nonexistent" not found in User');
  });
});

describe('createSelectProxy', () => {
  it('valid field returns SelectableField', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = createSelectProxy<any>('u', ir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const field = (proxy as any).name;
    expect(field.tableAlias).toBe('u');
    expect(field.fieldName).toBe('name');
  });

  it('field with alias uses alias as column', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = createSelectProxy<any>('u', ir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const field = (proxy as any).id;
    expect(field.column).toBe('id');
  });
});

describe('createOrderProxy', () => {
  it('valid field returns order object', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = createOrderProxy<any>('u', ir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order = (proxy as any).name;
    expect(order).toEqual({ tableAlias: 'u', fieldName: 'name', column: 'name' });
  });

  it('field with alias uses alias as column', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = createOrderProxy<any>('u', ir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order = (proxy as any).id;
    expect(order.column).toBe('id');
  });
});

describe('createRelationProxy', () => {
  it('ref field creates Relation via factory', () => {
    const sqb = makeSqb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = createRelationProxy<any>('u', ir, sqb, Relation as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rel = (proxy as any).posts;
    expect(rel).toBeInstanceOf(Relation);
  });

  it('non-ref field throws', () => {
    const sqb = makeSqb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = createRelationProxy<any>('u', ir, sqb, Relation as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (proxy as any).name).toThrow('Relation "name" not found in User');
  });

  it('irLookup resolves target IR', () => {
    const sqb = makeSqb();
    const postIr = makeUserIR();
    postIr.name = 'Post';
    const lookup = () => postIr;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = createRelationProxy<any>('u', ir, sqb, Relation as any, lookup);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rel = (proxy as any).posts;
    expect(rel.targetIr.name).toBe('Post');
  });

  it('irLookup undefined uses stub IR', () => {
    const sqb = makeSqb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = createRelationProxy<any>('u', ir, sqb, Relation as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rel = (proxy as any).posts;
    expect(rel.targetIr.name).toBe('Post');
    expect(rel.targetIr.collection).toBe('post');
  });
});
