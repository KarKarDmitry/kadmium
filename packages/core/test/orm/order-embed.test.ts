import { describe, it, expect } from 'vitest';
import { sql } from '../../src/orm/sql-fragment';
import { SingleQueryBuilder } from '../../src/orm/builders/single';
import type { SqlAdapter, OrderStep } from '@karkardmitry/kadmium-sql-types';
import { makeMockAdapter, type MockAdapter } from './helpers';
import type { ModelIR } from '../../src/ir/index';

const USER_IR: ModelIR = {
  name: 'User',
  collection: 'users',
  fields: {
    id: {
      type: 'bigint',
      alias: 'id',
      tsType: 'number',
      nullable: false,
      unique: true,
      index: false,
      isPrimary: true,
    },
    name: {
      type: 'string',
      alias: 'name',
      tsType: 'string',
      nullable: false,
      unique: false,
      index: false,
    },
    registeredAt: {
      type: 'datetime',
      alias: 'registered_at',
      tsType: 'Date',
      nullable: false,
      unique: false,
      index: false,
    },
  },
};

function builder(adapter?: MockAdapter) {
  return new SingleQueryBuilder(
    USER_IR,
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

describe('single order — sql-фрагмент в ORDER BY', () => {
  it('SqlOrder компилирует текст/параметры/слоты в конструкторе', () => {
    const order = sql`EXTRACT(YEAR FROM now())`.desc;
    expect(order.kind).toBe('sql-order');
    expect(order.text).toBe('EXTRACT(YEAR FROM now())');
    expect(order.values).toEqual([]);
    expect(order.slotOrder).toEqual([]);
    expect(order.direction).toBe('desc');
  });

  it('order() с фрагментом пушит OrderFragmentStep (kind: fragment)', () => {
    const b = builder();
    b.order((u: any) => [sql`EXTRACT(YEAR FROM "User"."registered_at")`.desc]);
    const step = b.sqb.orders[0] as OrderStep;
    expect(step).toMatchObject({
      kind: 'fragment',
      text: 'EXTRACT(YEAR FROM "User"."registered_at")',
      values: [],
      slotOrder: [],
      direction: 'desc',
    });
  });

  it('order() с полем пушит OrderColumnStep (без kind)', () => {
    const b = builder();
    b.order((u: any) => [u.name.asc]);
    expect(b.sqb.orders).toEqual([
      { field: 'name', column: 'name', tableAlias: 'User', direction: 'asc' },
    ]);
  });

  it('смешанный order(): колонка + фрагмент', () => {
    const b = builder();
    b.order((u: any) => [
      u.name.asc,
      sql<number>`"User"."registered_at" DESC NULLS LAST`.asc,
    ]);
    const [col, frag] = b.sqb.orders as OrderStep[];
    expect(col).toMatchObject({
      field: 'name',
      column: 'name',
      direction: 'asc',
    });
    expect(col).not.toHaveProperty('kind');
    expect(frag).toMatchObject({
      kind: 'fragment',
      text: '"User"."registered_at" DESC NULLS LAST',
      direction: 'asc',
    });
  });

  it('фрагмент с параметром кладёт значение в step.values', () => {
    const b = builder();
    b.order((u: any) => [sql`(age * ${2})`.desc]);
    const step = b.sqb.orders[0] as OrderStep;
    expect(step).toMatchObject({
      kind: 'fragment',
      text: '(age * $1)',
      direction: 'desc',
    });
    expect((step as { values: readonly unknown[] }).values).toEqual([2]);
  });

  it('clone() изолирует orders: мутация клона не трогает оригинал', () => {
    const b = builder();
    b.order((u: any) => [u.name.asc]);
    const c = b.clone();
    c.order((u: any) => [sql`(age * 2)`.desc]);
    expect(b.sqb.orders).toHaveLength(1);
    expect(c.sqb.orders).toHaveLength(2);
    expect(c.sqb.orders[1] as OrderStep).toMatchObject({
      kind: 'fragment',
      direction: 'desc',
    });
  });

  it('тип: голый фрагмент (без .asc/.desc) в order недопустим', () => {
    const b = builder();
    // @ts-expect-error — SqlFragment без направления не совместим с шагом order
    b.order((u: any) => [sql`(age * 2)`]);
  });
});
