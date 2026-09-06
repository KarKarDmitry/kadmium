import { describe, it, expect } from 'vitest';
import { invertRelation } from '../../../src/model/fields/model';

describe('invertRelation', () => {
  it('one-to-many → many-to-one', () => {
    expect(invertRelation('one-to-many')).toBe('many-to-one');
  });

  it('many-to-one → one-to-many', () => {
    expect(invertRelation('many-to-one')).toBe('one-to-many');
  });

  it('one-to-one → one-to-one', () => {
    expect(invertRelation('one-to-one')).toBe('one-to-one');
  });
});
