import { describe, it, expect } from 'vitest';
import { SlotMarker, slot, isHoleRef } from '../../src/orm/slot';
import { NumberFilter } from '../../src/orm/field-builders/filters';
import { makeSqb } from './helpers';

describe('slot', () => {
  it('creates a SlotMarker with kind slot and slotName', () => {
    const m = slot('tenantId');
    expect(m).toBeInstanceOf(SlotMarker);
    expect(m.kind).toBe('slot');
    expect(m.slotName).toBe('tenantId');
  });

  it('is usable as a value in eq', () => {
    const m = slot('age');
    const f = new NumberFilter(makeSqb(), 'age', 'u');
    const w = f.eq(m);
    expect(w.op).toBe('=');
    expect(w.value).toBe(m);
  });

  it('isHoleRef detects slot markers only', () => {
    expect(isHoleRef(slot('x'))).toBe(true);
    expect(isHoleRef({ kind: 'slot', slotName: 'y' })).toBe(true);
    expect(isHoleRef('x')).toBe(false);
    expect(isHoleRef(123)).toBe(false);
    expect(isHoleRef(null)).toBe(false);
    expect(isHoleRef(undefined)).toBe(false);
    expect(isHoleRef(new NumberFilter(makeSqb(), 'age', 'u'))).toBe(false);
  });
});
