import { describe, it, expect } from 'vitest';
import { and, or } from '../../src/orm/where-expression';
import type { WhereCondition } from '../../src/orm/ast/where';

function cond(field: string): WhereCondition {
  return { field, op: '=', value: 'x' };
}

describe('and/or combinators', () => {
  it('and produces an AND group', () => {
    const g = and(cond('a'), cond('b'));
    expect(g).toEqual({
      elements: [
        { join: 'AND', condition: cond('a') },
        { join: 'AND', condition: cond('b') },
      ],
    });
  });

  it('or produces an OR group', () => {
    const g = or(cond('a'), cond('b'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((g as any).elements[0].join).toBe('OR');
  });

  it('nests groups inside each other', () => {
    const g = or(cond('a'), and(cond('b'), cond('c')));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((g as any).elements.length).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((g as any).elements[1].condition.elements.length).toBe(2);
  });

  it('skips undefined arguments', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = and(cond('a'), undefined as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((g as any).elements.length).toBe(1);
  });

  it('returns undefined when all arguments are undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(and(undefined as any)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(or(undefined as any, undefined as any)).toBeUndefined();
  });

  it('returns undefined for empty args', () => {
    expect(and()).toBeUndefined();
    expect(or()).toBeUndefined();
  });
});