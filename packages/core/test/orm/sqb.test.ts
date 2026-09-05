import { describe, it, expect } from 'vitest';
import { KadmiumSqb } from '../../src/orm/sqb';

describe('KadmiumSqb', () => {
  it('default state', () => {
    const sqb = new KadmiumSqb();
    expect(sqb.operation).toBe('select');
    expect(sqb.tableContext.size).toBe(0);
    expect(sqb.wheres).toEqual({ op: 'AND', conditions: [] });
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

  it('clone deep-copies wheres', () => {
    const sqb = new KadmiumSqb();
    sqb.wheres.conditions.push({ field: 'name', op: '=', value: 'Alice' });
    const nested: any = {
      op: 'AND',
      conditions: [{ field: 'age', op: '>', value: 18 }],
    };
    sqb.wheres.conditions.push(nested);

    const cloned = sqb.clone();

    // Mutate original
    (sqb.wheres.conditions[0] as any).value = 'Bob';
    (sqb.wheres.conditions[1] as any).conditions[0].value = 25;

    expect((cloned.wheres.conditions[0] as any).value).toBe('Alice');
    expect((cloned.wheres.conditions[1] as any).conditions[0].value).toBe(18);
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
    sqb.joins.push({ left: 'u', right: 'p', on: { field: 'id', op: '=', value: 1 } });
    sqb.orders.push({ field: 'name', direction: 'asc' });
    sqb.groupBy.push('name');

    const cloned = sqb.clone();

    sqb.joins.push({ left: 'a', right: 'b', on: { field: 'x', op: '=', value: 2 } });
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
});
