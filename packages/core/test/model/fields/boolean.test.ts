import { describe, it, expect } from 'vitest';
import f from '../../../src/model/fields';

describe('BooleanFieldBuilder', () => {
  it('$build: spec.default is false by default', () => {
    const field = f.bool.$build();
    expect(field.spec).toEqual({ default: false });
  });

  it('.default(true) sets spec.default', () => {
    const field = f.bool.default(true).$build();
    expect(field.spec).toEqual({ default: true });
  });

  it('tsType is boolean', () => {
    const field = f.bool.$build();
    expect(field.tsType).toBe('boolean');
  });

  it('inherited .notNull() works', () => {
    const field = f.bool.notNull().$build();
    expect(field.db.nullable).toBe(false);
  });
});
