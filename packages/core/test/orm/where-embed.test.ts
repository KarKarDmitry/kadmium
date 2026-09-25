import { describe, it, expect } from 'vitest';
import { sql, SqlCondition, toSqlCondition } from '../../src/orm/sql-fragment';
import { and, or } from '../../src/orm/where-expression';
import { SingleQueryBuilder } from '../../src/orm/builders/single';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import { makeMockAdapter, type MockAdapter, makeUserIR } from './helpers';
import type { WhereStep } from '../../src/orm/ast/where';

function builder(adapter?: MockAdapter) {
  return new SingleQueryBuilder(
    makeUserIR(),
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

describe('where — sql-фрагмент в WHERE (E)', () => {
  it('SqlCondition компилирует текст/параметры/слоты в конструкторе', () => {
    const cond = new SqlCondition(sql`"User"."age" > ${25}`);
    expect(cond.kind).toBe('sql-condition');
    expect(cond.text).toBe('"User"."age" > $1');
    expect(cond.values).toEqual([25]);
    expect(cond.slotOrder).toEqual([]);
  });

  it('where() с голым фрагментом пушит шаг со SqlCondition', () => {
    const b = builder();
    b.where((u: any) => sql`"User"."age" > ${25}`);
    expect(b.sqb.wheres.elements).toHaveLength(1);
    const condition = b.sqb.wheres.elements[0].condition;
    expect(condition).toBeInstanceOf(SqlCondition);
    expect((condition as SqlCondition).text).toBe('"User"."age" > $1');
    expect((condition as SqlCondition).values).toEqual([25]);
  });

  it('toSqlCondition: SqlFragment → SqlCondition, остальное as-is', () => {
    const wrapped = toSqlCondition(sql`a = 1`);
    expect(wrapped).toBeInstanceOf(SqlCondition);
    const plain = { field: 'name', op: '=', value: 'Alice' };
    expect(toSqlCondition(plain)).toBe(plain);
  });

  it('and()/or() с фрагментами строят группу с SqlCondition-листьями', () => {
    const g = or(sql`a = ${1}`, sql`b = ${2}`);
    expect(g).toBeDefined();
    expect(g!.elements).toHaveLength(2);
    expect(g!.elements[0].join).toBe('OR');
    expect(g!.elements[0].condition).toBeInstanceOf(SqlCondition);
    expect((g!.elements[0].condition as SqlCondition).text).toBe('a = $1');
  });

  it('and()/or() смешивают условие и фрагмент', () => {
    const plain = { field: 'name', op: '=', value: 'Alice' };
    const g = and(sql`"User"."age" > ${25}`, plain);
    expect(g).toBeDefined();
    expect((g!.elements[0].condition as SqlCondition).values).toEqual([25]);
    expect(g!.elements[1].condition).toEqual(plain);
  });

  it('фрагмент внутри вложенной and()-группы в where()', () => {
    const b = builder();
    b.where((u: any) => and(u.active.eq(true), sql`"User"."age" > ${25}`));
    const condition = b.sqb.wheres.elements[0].condition;
    expect(condition).toHaveProperty('elements');
    const steps = (condition as { elements: WhereStep[] }).elements;
    expect(steps).toHaveLength(2);
    expect(steps[0].condition).toMatchObject({ field: 'active', op: '=' });
    expect(steps[1].condition).toBeInstanceOf(SqlCondition);
  });

  it('having() с фрагментом пушит SqlCondition в havings', () => {
    const b = builder();
    b.select((t: any, tools: any) => [tools.agg.count('*').as('cnt')]);
    b.having((t: any) => sql`COUNT(*) > ${1}`);
    expect(b.sqb.havings.elements).toHaveLength(1);
    const condition = b.sqb.havings.elements[0].condition;
    expect(condition).toBeInstanceOf(SqlCondition);
    expect((condition as SqlCondition).text).toBe('COUNT(*) > $1');
  });

  it('update().where() нормализует фрагмент в шаге', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 5, active: false }]);
    const finalizer = builder(adapter).update({ active: false });
    const res = await finalizer.where((u: any) => sql`"User"."id" = ${5}`).go();
    expect(res).toEqual([{ id: 5, active: false }]);
    const captured = adapter.execute.mock.calls[0][0] as {
      wheres: { elements: { condition: unknown }[] };
    };
    expect(captured.wheres.elements).toHaveLength(1);
    expect(captured.wheres.elements[0].condition).toBeInstanceOf(SqlCondition);
  });

  it('тип: cursor() не принимает sql-фрагмент (только поля)', () => {
    const b = builder();
    b.order((u: any) => [u.id.asc]);
    // @ts-expect-error — cursor только по полям, без фрагментов
    b.cursor((u: any) => sql`"User"."id" > ${1}`);
  });
});
