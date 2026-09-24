import { describe, it, expect } from 'vitest';
import { KadmiumSqb } from '../../../src/orm/sqb';
import { createFilter } from '../../../src/orm/field-builders/factory';
import type { FieldIR } from '../../../src/ir/index';

function uuidFieldIr(overrides?: Partial<FieldIR>): FieldIR {
  return {
    type: 'uuid',
    tsType: 'string',
    alias: 'id',
    nullable: false,
    unique: true,
    index: true,
    isPrimary: true,
    ...overrides,
  } as FieldIR;
}

describe('uuid fields are filterable', () => {
  it('createFilter returns a filter exposing .eq() for a uuid PK', () => {
    const filter = createFilter(
      new KadmiumSqb(),
      'id',
      'UserAccount',
      uuidFieldIr(),
    );
    expect(typeof (filter as { eq?: unknown }).eq).toBe('function');
  });
});
