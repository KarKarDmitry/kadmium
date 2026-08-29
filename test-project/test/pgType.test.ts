import { pgType, normalizePgType } from '@karkardmitry/kadmium-sql-pg';

const irs: Array<{ name: string; fields: Record<string, any> }> = [];

describe('pgType', () => {
  it('decimal → numeric', () => {
    expect(pgType('value', { type: 'decimal', nullable: false } as any, irs)).toBe('numeric');
  });

  it('float → double precision', () => {
    expect(pgType('value', { type: 'float', nullable: false } as any, irs)).toBe('double precision');
  });

  it('numeric → numeric', () => {
    expect(pgType('value', { type: 'numeric', nullable: false } as any, irs)).toBe('numeric');
  });

  it('bigint → bigint', () => {
    expect(pgType('id', { type: 'bigint', nullable: false } as any, irs)).toBe('bigint');
  });

  it('int → integer', () => {
    expect(pgType('id', { type: 'int', nullable: false } as any, irs)).toBe('integer');
  });

  it('number → integer', () => {
    expect(pgType('id', { type: 'number', nullable: false } as any, irs)).toBe('integer');
  });

  it('string → character varying', () => {
    expect(pgType('name', { type: 'string' } as any, irs)).toBe('character varying');
  });

  it('boolean → boolean', () => {
    expect(pgType('flag', { type: 'boolean' } as any, irs)).toBe('boolean');
  });

  it('date → date', () => {
    expect(pgType('d', { type: 'date' } as any, irs)).toBe('date');
  });

  it('datetime → timestamp without time zone', () => {
    expect(pgType('d', { type: 'datetime' } as any, irs)).toBe('timestamp without time zone');
  });

  it('uuid PK → uuid', () => {
    expect(pgType('id', { type: 'primary', spec: { db_type: 'uuid' } } as any, irs)).toBe('uuid');
  });

  it('default primary → integer', () => {
    expect(pgType('id', { type: 'primary' } as any, irs)).toBe('integer');
  });

  it('unknown → text', () => {
    expect(pgType('x', { type: 'unknown' } as any, irs)).toBe('text');
  });
});

describe('normalizePgType', () => {
  it('normalizes character varying', () => {
    expect(normalizePgType('character varying')).toBe('varchar');
  });

  it('normalizes timestamp without time zone', () => {
    expect(normalizePgType('timestamp without time zone')).toBe('timestamp');
  });

  it('normalizes integer variants', () => {
    expect(normalizePgType('int')).toBe('integer');
    expect(normalizePgType('int4')).toBe('integer');
  });

  it('normalizes double precision', () => {
    expect(normalizePgType('double precision')).toBe('float8');
  });

  it('normalizes numeric and decimal', () => {
    expect(normalizePgType('numeric')).toBe('numeric');
    expect(normalizePgType('decimal')).toBe('numeric');
  });

  it('normalizes bigint', () => {
    expect(normalizePgType('bigint')).toBe('bigint');
  });
});
