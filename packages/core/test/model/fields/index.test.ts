import { describe, it, expect } from 'vitest';
import f from '../../../src/model/fields';
import { StringFieldBuilder } from '../../../src/model/fields/string';
import { BooleanFieldBuilder } from '../../../src/model/fields/boolean';
import { NumberFieldBuilder } from '../../../src/model/fields/number';
import { PrimaryFieldBuilder } from '../../../src/model/fields/primary';
import { DateTimeFieldBuilder } from '../../../src/model/fields/datetime';
import { ReferenceFieldBuilder } from '../../../src/model/fields/ref';

describe('f barrel', () => {
  it('f.string is StringFieldBuilder', () => {
    expect(f.string).toBeInstanceOf(StringFieldBuilder);
  });

  it('f.bool is BooleanFieldBuilder', () => {
    expect(f.bool).toBeInstanceOf(BooleanFieldBuilder);
  });

  it('f.number is NumberFieldBuilder', () => {
    expect(f.number).toBeInstanceOf(NumberFieldBuilder);
  });

  it('f.pk is PrimaryFieldBuilder', () => {
    expect(f.pk).toBeInstanceOf(PrimaryFieldBuilder);
  });

  it('f.datetime is DateTimeFieldBuilder', () => {
    expect(f.datetime).toBeInstanceOf(DateTimeFieldBuilder);
  });

  it('f.ref is ReferenceFieldBuilder', () => {
    expect(f.ref).toBeInstanceOf(ReferenceFieldBuilder);
  });

  it('f.string !== f.string (fresh instance each time)', () => {
    expect(f.string).not.toBe(f.string);
  });
});
