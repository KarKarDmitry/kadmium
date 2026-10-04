import { describe, it, expect } from 'vitest';
import { createFilter } from '../../src/orm/field-builders/factory';
import {
  StringFilter,
  NumberFilter,
  BooleanFilter,
  DateFilter,
} from '../../src/orm/field-builders/filters';
import { BaseFilter } from '../../src/orm/field-builders/base-filter';
import type { FieldIR } from '../../src/ir/index';
import { makeSqb, makeUserIR } from './helpers';

const sqb = makeSqb();
const ir = makeUserIR();

describe('createFilter', () => {
  it('string → StringFilter', () => {
    const f = createFilter(sqb, 'name', 'u', ir.fields.name);
    expect(f).toBeInstanceOf(StringFilter);
  });

  it('number → NumberFilter', () => {
    const f = createFilter(sqb, 'age', 'u', ir.fields.age);
    expect(f).toBeInstanceOf(NumberFilter);
  });

  it('primary → NumberFilter', () => {
    const f = createFilter(sqb, 'id', 'u', ir.fields.id);
    expect(f).toBeInstanceOf(NumberFilter);
  });

  it('ref → NumberFilter', () => {
    const f = createFilter(sqb, 'posts', 'u', ir.fields.posts);
    expect(f).toBeInstanceOf(NumberFilter);
  });

  it('boolean → BooleanFilter', () => {
    const f = createFilter(sqb, 'active', 'u', ir.fields.active);
    expect(f).toBeInstanceOf(BooleanFilter);
  });

  it('datetime → DateFilter', () => {
    const datetimeIr: FieldIR = {
      type: 'datetime' as const,
      alias: 'created',
      tsType: 'Date',
      nullable: false,
      unique: false,
      index: false,
    };
    const f = createFilter(sqb, 'created', 'u', datetimeIr);
    expect(f).toBeInstanceOf(DateFilter);
  });

  it('date → StringFilter', () => {
    // `date` объявлен как string, и `FieldTypeToFilter` в proxy.d.ts отдаёт
    // для него StringFilter — рантайм обязан отдавать тот же класс.
    const dateIr: FieldIR = {
      type: 'date' as const,
      alias: 'birth',
      tsType: 'string',
      nullable: false,
      unique: false,
      index: false,
    };
    const f = createFilter(sqb, 'birth', 'u', dateIr);
    expect(f).toBeInstanceOf(StringFilter);
    expect(f).not.toBeInstanceOf(DateFilter);
  });

  it('time → StringFilter', () => {
    const timeIr: FieldIR = {
      type: 'time' as const,
      alias: 'at',
      tsType: 'string',
      nullable: false,
      unique: false,
      index: false,
    };
    const f = createFilter(sqb, 'at', 'u', timeIr);
    expect(f).toBeInstanceOf(StringFilter);
    expect(f).not.toBeInstanceOf(DateFilter);
  });

  it('unknown type → BaseFilter', () => {
    // Неизвестен именно FieldType (`jsonb` нет в юнионе), а не tsType.
    const jsonbIr: FieldIR = {
      type: 'jsonb' as any,
      alias: 'data',
      tsType: 'string',
      nullable: false,
      unique: false,
      index: false,
    };
    const f = createFilter(sqb, 'data', 'u', jsonbIr);
    expect(f).toBeInstanceOf(BaseFilter);
    expect(f).not.toBeInstanceOf(StringFilter);
  });

  it('nullable adds .null and .notNull', () => {
    const f = createFilter(sqb, 'age', 'u', ir.fields.age);
    expect('null' in f).toBe(true);
    expect('notNull' in f).toBe(true);
  });

  it('non-nullable has no .null/.notNull', () => {
    const f = createFilter(sqb, 'name', 'u', ir.fields.name);
    expect('null' in f).toBe(false);
  });

  it('column mapping uses ir.alias', () => {
    const f = createFilter(sqb, 'name', 'u', ir.fields.name);
    expect(f.column).toBe('name');
  });

  it('column mapping falls back to field name', () => {
    const noAliasIr = { ...ir.fields.name, alias: 'name' };
    const f = createFilter(sqb, 'name', 'u', noAliasIr);
    expect(f.column).toBe('name');
  });
});
