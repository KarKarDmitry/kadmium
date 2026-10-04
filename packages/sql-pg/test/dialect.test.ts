import { describe, it, expect } from 'vitest';
import { pgDialect } from '../src/dialect';
import {
  pgType,
  normalizePgType,
  renderDefault,
  defaultsEqual,
} from '../src/diff/types';
import type { IrField, IrModel } from '@karkardmitry/kadmium-sql-types';

const fld = (type: string, spec?: Record<string, unknown>): IrField => ({
  type,
  nullable: false,
  unique: false,
  spec,
});

describe('pgDialect', () => {
  it('typeName agrees with pgType', () => {
    const f = fld('datetime', { tz: true });
    expect(pgDialect.typeName(f, [])).toBe(pgType(f, []));
    expect(pgDialect.typeName(f, [])).toBe('timestamp with time zone');
  });

  it('typeName resolves a ref through the target model PK', () => {
    const irs: IrModel[] = [
      { name: 'User', collection: 'users', fields: { id: fld('primary') } },
      {
        name: 'Post',
        collection: 'posts',
        fields: { author: { ...fld('ref'), ref: 'User' } },
      },
    ];
    expect(pgDialect.typeName(irs[1].fields.author, irs)).toBe('integer');
  });

  it('normalizeTypeName agrees with normalizePgType', () => {
    expect(pgDialect.normalizeTypeName('TIMESTAMP(3) WITH TIME ZONE')).toBe(
      normalizePgType('TIMESTAMP(3) WITH TIME ZONE'),
    );
  });

  it('renderDefault agrees with renderDefault, including no-default', () => {
    expect(pgDialect.renderDefault(fld('int', { default: 5 }))).toBe(
      renderDefault(fld('int', { default: 5 })),
    );
    // serial: автоинкремент приходит из БД, дефолта в модели нет
    expect(
      pgDialect.renderDefault(fld('primary', { autoIncrement: true })),
    ).toBe(null);
  });

  it('defaultsEqual delegates, keeping the tz-aware branch', () => {
    const tz = fld('datetime', { tz: true });
    // Инстанты совпадают, текст — нет: это единственное место, где tz влияет
    expect(
      pgDialect.defaultsEqual(
        tz,
        '2026-01-01T12:00:00+09:00',
        '2026-01-01T03:00:00Z',
      ),
    ).toBe(true);
    expect(pgDialect.defaultsEqual(fld('int'), '5', '5')).toBe(
      defaultsEqual(fld('int'), '5', '5'),
    );
    expect(pgDialect.defaultsEqual(fld('int'), null, '5')).toBe(false);
  });
});
