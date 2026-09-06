import { describe, it, expect } from 'vitest';
import f from '../../../src/model/fields';

describe('PrimaryFieldBuilder', () => {
  it('$build: type=bigint, increment=true', () => {
    const field = f.pk.$build();
    expect(field.type).toBe('bigint');
    expect(field.increment).toBe(true);
  });

  it('f.pk has no .unique(), .notNull(), .index() methods', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((f.pk as any).unique).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((f.pk as any).notNull).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((f.pk as any).index).toBeUndefined();
  });

  it('f.pk.bigint.$build: type=bigint', () => {
    const field = f.pk.bigint.$build();
    expect(field.type).toBe('bigint');
  });

  it('f.pk.string.$build: type=string, spec=auto', () => {
    const field = f.pk.string.$build();
    expect(field.type).toBe('string');
    expect(field.spec).toBe('auto');
  });

  it('f.pk.uuid.$build: type=uuid, db_type=uuid', () => {
    const field = f.pk.uuid.$build();
    expect(field.type).toBe('uuid');
    expect(field.db.db_type).toBe('uuid');
  });

  it('db: index=true, unique=true, nullable=false', () => {
    const field = f.pk.$build();
    expect(field.db.index).toBe(true);
    expect(field.db.unique).toBe(true);
    expect(field.db.nullable).toBe(false);
  });

  it('f.pk.$build() twice returns independent objects', () => {
    const a = f.pk.$build();
    const b = f.pk.$build();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('tsType: number for bigint, string for string/uuid', () => {
    expect(f.pk.bigint.$build().tsType).toBe('number');
    expect(f.pk.string.$build().tsType).toBe('string');
    expect(f.pk.uuid.$build().tsType).toBe('string');
  });
});
