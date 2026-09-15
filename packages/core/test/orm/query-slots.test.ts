import { describe, it, expect } from 'vitest';
import { QuerySlots, ToDef } from '../../src/orm/query-slots';
import { SlotMarker } from '../../src/orm/slot';
import { ArrayField } from '../../src/orm/ast/array-field';
import { SelectableField } from '../../src/orm/ast/selectable';
import {
  StringFilter,
  NumberFilter,
} from '../../src/orm/field-builders/filters';
import { aggregates } from '../../src/orm/field-builders/aggregates';
import { SingleQueryBuilder } from '../../src/orm/builders/single';
import { AllFields } from '../../src/orm/types/includes';
import { makeSqb, makeUserIR } from './helpers';
import type { SlotDefinition } from '@karkardmitry/kadmium-sql-types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

class User2 {
  ['~shape']!: { id: number; name: string; createdAt: Date; tenantId: number };
  ['~rel']!: Record<string, unknown>;
  ['~relInfo']!: Record<string, unknown>;
}

describe('ToDef (type-level extraction)', () => {
  it('maps plain selectable to field name', () => {
    const e: Equal<
      ToDef<[SelectableField<number, 'id'>]>,
      { id: number }
    > = true;
    expect(e).toBe(true);
  });

  it('maps aliased selectable to alias', () => {
    const e: Equal<
      ToDef<[SelectableField<Date, 'createdAt', 'since'>]>,
      { since: Date }
    > = true;
    expect(e).toBe(true);
  });

  it('maps aliased aggregate to its result type', () => {
    const e: Equal<
      ToDef<[ReturnType<typeof aggregates.count> & { alias: 'cnt' }]>,
      { cnt: number }
    > = true;
    expect(e).toBe(true);
  });

  it('maps ArrayField value as array of model element', () => {
    const e: Equal<
      ToDef<[ArrayField<number[], 'id', 'ids'>]>,
      { ids: number[] }
    > = true;
    expect(e).toBe(true);
  });
});

describe('QuerySlots — type-level', () => {
  it('slot() is typed by ToDef (alias, plain, array)', () => {
    const S = new QuerySlots(User2).push((u) => [
      u.tenantId,
      u.createdAt.as('since'),
      u.id.array.as('ids'),
    ]);
    const tenant = S.slot('tenantId');
    const since = S.slot('since');
    const ids = S.slot('ids');
    const e1: Equal<typeof tenant, SlotMarker<'tenantId', number>> = true;
    const e2: Equal<typeof since, SlotMarker<'since', Date>> = true;
    const e3: Equal<typeof ids, SlotMarker<'ids', number[]>> = true;
    expect(e1 && e2 && e3).toBe(true);
  });

  it('slot name outside ToDef is a type error', () => {
    const S = new QuerySlots(User2).push((u) => [u.tenantId]);
    // @ts-expect-error — 'name' не в ToDef<S> ({ tenantId })
    S.slot('name');
  });

  it('.array and .as() commute to the same slot type', () => {
    const a = new QuerySlots(User2).push((u) => [u.id.as('k1').array]);
    const b = new QuerySlots(User2).push((u) => [u.id.array.as('k2')]);
    const ka = a.slot('k1');
    const kb = b.slot('k2');
    const e1: Equal<typeof ka, SlotMarker<'k1', number[]>> = true;
    const e2: Equal<typeof kb, SlotMarker<'k2', number[]>> = true;
    expect(e1 && e2).toBe(true);
  });

  it('eq accepts a typed slot of matching value', () => {
    const S = new QuerySlots(User2).push((u) => [u.tenantId]);
    const f = new NumberFilter(makeSqb(), 'tenantId', 'u');
    f.eq(S.slot('tenantId'));
  });

  it('eq rejects a typed slot of mismatched value', () => {
    const S = new QuerySlots(User2).push((u) => [u.tenantId]);
    const f = new StringFilter(makeSqb(), 'name', 'u');
    // @ts-expect-error — SlotMarker<'tenantId', number> не легален в eq string
    f.eq(S.slot('tenantId'));
  });

  it('in() accepts an ArrayField slot (BaseFilter<number[]>)', () => {
    const S = new QuerySlots(User2).push((u) => [u.id.array.as('ids')]);
    const f = new NumberFilter(makeSqb(), 'id', 'u');
    f.in(S.slot('ids'));
  });

  it('ArrayField is excluded from select (not a column)', () => {
    const b = new SingleQueryBuilder<User2, AllFields>(makeUserIR(), undefined);
    // @ts-expect-error — ArrayField — не колонка, select([u.id.array]) запрещён
    b.select((u) => [u.id.array]);
  });
});

describe('QuerySlots — runtime', () => {
  it('push returns a QuerySlots instance (callback not executed)', () => {
    const S = new QuerySlots(User2).push((u) => [u.tenantId]);
    expect(S).toBeInstanceOf(QuerySlots);
  });

  it('slot() creates a SlotMarker with the given name', () => {
    const S = new QuerySlots(User2).push((u) => [u.tenantId]);
    const m = S.slot('tenantId');
    expect(m).toBeInstanceOf(SlotMarker);
    expect(m.kind).toBe('slot');
    expect(m.slotName).toBe('tenantId');
  });

  it('assertSlotNames accepts declared names only', () => {
    const S = new QuerySlots(User2).push((u) => [u.tenantId]);
    S.slot('tenantId');
    const declared: SlotDefinition[] = [{ name: 'tenantId', index: 1 }];
    expect(() => S.assertSlotNames(declared)).not.toThrow();
    const unknown: SlotDefinition[] = [{ name: 'nope', index: 1 }];
    expect(() => S.assertSlotNames(unknown)).toThrow(/not declared.*nope/);
  });

  it('typed slot usable in eq', () => {
    const S = new QuerySlots(User2).push((u) => [u.tenantId]);
    const f = new NumberFilter(makeSqb(), 'tenantId', 'u');
    const m = S.slot('tenantId');
    const cond = f.eq(m);
    expect(cond.op).toBe('=');
    expect(cond.value).toBe(m);
  });

  it('typed array slot usable in in()', () => {
    const S = new QuerySlots(User2).push((u) => [u.id.array.as('ids')]);
    const f = new NumberFilter(makeSqb(), 'id', 'u');
    const m = S.slot('ids');
    const cond = f.in(m);
    expect(cond.op).toBe('IN');
    expect((cond.value as { kind: string }).kind).toBe('slot');
  });
});
