import { Model, f } from '@karkardmitry/kadmium-core';
import { compileModel } from '@karkardmitry/kadmium-core';

class DecimalModel extends Model {
  id = f.pk;
  value = f.number.decimal;
}

class BigIntModel extends Model {
  id = f.pk.bigint;
}

class StringModel extends Model {
  name = f.string;
}

describe('compileModel — type preservation', () => {
  it('decimal → decimal', () => {
    const ir = compileModel(new DecimalModel());
    expect(ir.fields.value.type).toBe('decimal');
  });

  it('bigint PK → bigint', () => {
    const ir = compileModel(new BigIntModel());
    expect(ir.fields.id.type).toBe('bigint');
  });

  it('string stays string', () => {
    const ir = compileModel(new StringModel());
    expect(ir.fields.name.type).toBe('string');
  });

  it('PK default is bigint', () => {
    class DefaultPK extends Model {}
    const ir = compileModel(new DefaultPK());
    expect(ir.fields.id.type).toBe('bigint');
  });
});
