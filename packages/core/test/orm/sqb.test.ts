import { describe, it, expect } from 'vitest';
import { KadmiumSqb } from '../../src/orm/sqb';

describe('KadmiumSqb', () => {
  it('default state', () => {
    const sqb = new KadmiumSqb();
    expect(sqb.operation).toBe('select');
    expect(sqb.isMulti).toBe(false);
    expect(sqb.tableContext.size).toBe(0);
    expect(sqb.wheres).toEqual({ elements: [] });
    expect(sqb.cursor).toEqual({ elements: [] });
    expect(sqb.selects).toBeNull();
    expect(sqb.joins).toEqual([]);
    expect(sqb.includes).toEqual([]);
    expect(sqb.orders).toEqual([]);
    expect(sqb.limit).toBeNull();
    expect(sqb.offset).toBeNull();
    expect(sqb.groupBy).toEqual([]);
    expect(sqb.updateData).toBeNull();
  });

  it('clone produces independent copy', () => {
    const sqb = new KadmiumSqb();
    sqb.tableContext.set('u', 'users');
    sqb.limit = 10;
    sqb.groupBy.push('name');

    const cloned = sqb.clone();

    sqb.tableContext.set('p', 'posts');
    sqb.limit = 20;
    sqb.groupBy.push('email');

    expect(cloned.tableContext.size).toBe(1);
    expect(cloned.tableContext.get('u')).toBe('users');
    expect(cloned.limit).toBe(10);
    expect(cloned.groupBy).toEqual(['name']);
  });

  it('clone copies isMulti flag', () => {
    const multi = new KadmiumSqb();
    multi.isMulti = true;
    const cloned = multi.clone();
    expect(cloned.isMulti).toBe(true);
    multi.isMulti = false;
    expect(cloned.isMulti).toBe(true);
  });

  it('clone deep-copies wheres', () => {
    const sqb = new KadmiumSqb();
    sqb.wheres.elements.push({
      join: 'AND',
      condition: { field: 'name', op: '=', value: 'Alice' },
    });

    const nested: any = {
      elements: [
        { join: 'OR', condition: { field: 'age', op: '>', value: 18 } },
      ],
    };
    sqb.wheres.elements.push({ join: 'OR', condition: nested });

    const cloned = sqb.clone();

    // Mutate original

    (sqb.wheres.elements[0] as any).condition.value = 'Bob';

    (sqb.wheres.elements[1] as any).condition.elements[0].condition.value = 25;

    expect((cloned.wheres.elements[0] as any).condition.value).toBe('Alice');

    expect(
      (cloned.wheres.elements[1] as any).condition.elements[0].condition.value,
    ).toBe(18);
  });

  it('clone deep-copies cursor', () => {
    const sqb = new KadmiumSqb();
    sqb.cursor.elements.push({
      join: 'AND',
      condition: { field: 'id', op: '>', value: 42 },
    });

    const nested: any = {
      elements: [
        { join: 'OR', condition: { field: 'age', op: '>', value: 18 } },
      ],
    };
    sqb.cursor.elements.push({ join: 'AND', condition: nested });

    const cloned = sqb.clone();

    (sqb.cursor.elements[0] as any).condition.value = 100;

    (sqb.cursor.elements[1] as any).condition.elements[0].condition.value = 25;

    expect((cloned.cursor.elements[0] as any).condition.value).toBe(42);

    expect(
      (cloned.cursor.elements[1] as any).condition.elements[0].condition.value,
    ).toBe(18);
  });

  it('clone copies tableContext Map', () => {
    const sqb = new KadmiumSqb();
    sqb.tableContext.set('u', 'users');

    const cloned = sqb.clone();
    sqb.tableContext.set('p', 'posts');

    expect(cloned.tableContext.size).toBe(1);
    expect(cloned.tableContext.has('p')).toBe(false);
  });

  it('clone copies arrays independently', () => {
    const sqb = new KadmiumSqb();
    sqb.joins.push({
      left: 'u',
      right: 'p',
      on: { field: 'id', op: '=', value: 1 },
    });
    sqb.orders.push({ field: 'name', direction: 'asc' });
    sqb.groupBy.push('name');

    const cloned = sqb.clone();

    sqb.joins.push({
      left: 'a',
      right: 'b',
      on: { field: 'x', op: '=', value: 2 },
    });
    sqb.orders.push({ field: 'age', direction: 'desc' });
    sqb.groupBy.push('email');

    expect(cloned.joins.length).toBe(1);
    expect(cloned.orders.length).toBe(1);
    expect(cloned.groupBy.length).toBe(1);
  });

  it('clone copies updateData', () => {
    const sqb = new KadmiumSqb();
    sqb.updateData = { name: 'Alice' };

    const cloned = sqb.clone();
    sqb.updateData!.name = 'Bob';

    expect(cloned.updateData!.name).toBe('Alice');
  });

  it('clone deep-copies includes (independent internalSqb)', () => {
    const sqb = new KadmiumSqb();
    const innerSqb = new KadmiumSqb();
    innerSqb.wheres.elements.push({
      join: 'AND',
      condition: { field: 'published', op: '=', value: true },
    });
    sqb.includes.push({
      parentAlias: 'u',
      propertyName: 'posts',
      relationType: 'one-to-many',
      targetIr: {
        name: 'Post',
        collection: 'post',
        fields: {},
      },
      parentField: 'id',
      childField: 'userId',
      internalSqb: innerSqb,
    });

    const cloned = sqb.clone();

    // Mutate original's include internalSqb
    sqb.includes[0].internalSqb.wheres.elements.push({
      join: 'AND',
      condition: { field: 'title', op: 'LIKE', value: '%test%' },
    });

    // Clone should be independent
    expect(cloned.includes[0].internalSqb.wheres.elements).toHaveLength(1);
    expect(cloned.includes[0].internalSqb.wheres.elements[0].condition).toEqual(
      { field: 'published', op: '=', value: true },
    );

    // Array itself is independent
    cloned.includes.push({
      parentAlias: 'u',
      propertyName: 'comments',
      relationType: 'one-to-many',
      targetIr: {
        name: 'Comment',
        collection: 'comment',
        fields: {},
      },
      parentField: 'id',
      childField: 'postId',
      internalSqb: new KadmiumSqb(),
    });
    expect(sqb.includes).toHaveLength(1);
  });
});
