import { describe, it, expect } from 'vitest';
import f from '../../../src/model/fields';

describe('StringFieldBuilder', () => {
  it('$build: _type=string, tsType=string, spec={}', () => {
    const field = f.string.$build();
    expect(field._meta._type).toBe('string');
    expect(field.tsType).toBe('string');
    expect(field.spec).toEqual({});
  });

  it('.default() sets spec.default', () => {
    const field = f.string.default('hello').$build();
    expect(field.spec).toEqual({ default: 'hello' });
  });

  it('.min().max() sets spec', () => {
    const field = f.string.min(1).max(100).$build();
    expect(field.spec).toEqual({ min: 1, max: 100 });
  });

  it('inherited .unique().notNull() work', () => {
    const field = f.string.unique().notNull().$build();
    expect(field.db.unique).toBe(true);
    expect(field.db.nullable).toBe(false);
  });

  it('chain returns this', () => {
    const builder = f.string;
    expect(builder.default('x')).toBe(builder);
    expect(builder.min(1)).toBe(builder);
    expect(builder.max(10)).toBe(builder);
  });
});
