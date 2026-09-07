import { describe, it, expect } from 'vitest';
import {
  createFilterProxy,
  createSelectProxy,
  createOrderProxy,
} from '../../src/orm/builders/query-proxies';
import { makeSqb, makeUserIR } from './helpers';

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
