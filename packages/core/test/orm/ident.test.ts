import { describe, expect, it } from 'vitest';
import {
  sql,
  ident,
  IdentMarker,
  isIdentMarker,
  toSqlValue,
  type SqlValue,
} from '../../src/orm/sql-fragment';
import { SelectableField } from '../../src/orm/ast/selectable';

describe('ident — динамический SQL-идентификатор (G)', () => {
  it('marker: kind + name', () => {
    const m = ident('col');
    expect(m).toBeInstanceOf(IdentMarker);
    expect(m).toEqual({ kind: 'ident', name: 'col' });
    expect(isIdentMarker(m)).toBe(true);
    expect(isIdentMarker(5)).toBe(false);
    expect(isIdentMarker('col')).toBe(false);
  });

  it('валидные имена', () => {
    expect(ident('col').name).toBe('col');
    expect(ident('_x').name).toBe('_x');
    expect(ident('registeredAt').name).toBe('registeredAt');
    expect(ident('p1').name).toBe('p1');
    expect(ident('a'.repeat(63)).name).toBe('a'.repeat(63));
  });

  it('инвалидные имена — throw при вызове', () => {
    const bad = [
      '',
      'a.b',
      'col; DROP',
      'col --',
      '1x',
      'a b',
      '"col"',
      "'col'",
    ];
    for (const name of bad) {
      expect(() => ident(name)).toThrow(/Invalid SQL identifier/);
    }
    expect(() => ident('a'.repeat(64))).toThrow(/Invalid SQL identifier/);
  });

  it('рендер: цитируемый идентификатор, не параметр', () => {
    const c = sql`SELECT ${ident('name')} FROM ${ident('user')}`.compile();
    expect(c.text).toBe('SELECT "name" FROM "user"');
    expect(c.values).toEqual([]);
    expect(c.slotOrder).toEqual([]);
  });

  it('регистр сохраняется: ident("createdAt") → "createdAt"', () => {
    const c = sql`ORDER BY ${ident('createdAt')}`.compile();
    expect(c.text).toBe('ORDER BY "createdAt"');
  });

  it('квалификация композицией: ${ident("t")}.${ident("c")}', () => {
    const c = sql`SELECT ${ident('t')}.${ident('c')} FROM "t"`.compile();
    expect(c.text).toBe('SELECT "t"."c" FROM "t"');
    expect(c.values).toEqual([]);
  });

  it('смесь ident + параметры: нумерация $N не сбивается', () => {
    const c =
      sql`SELECT ${ident('name')} FROM ${ident('user')} WHERE ${ident('age')} > ${18}`.compile();
    expect(c.text).toBe('SELECT "name" FROM "user" WHERE "age" > $1');
    expect(c.values).toEqual([18]);
  });

  it('ident во вложенном фрагменте: сдвиг $N при встраивании', () => {
    const inner = sql`${ident('age')} > ${18}`;
    const c =
      sql`SELECT ${ident('name')} FROM ${ident('user')} WHERE ${inner}`.compile();
    expect(c.text).toBe('SELECT "name" FROM "user" WHERE "age" > $1');
    expect(c.values).toEqual([18]);
  });

  it('ident в листах: SqlSelectable (.as), SqlOrder (.desc), SqlValue (DML)', () => {
    const sel = sql`${ident('name')} AS n`.as('n');
    expect(sel.text).toBe('"name" AS n');

    const ord = sql`${ident('age')}`.desc;
    expect(ord.text).toBe('"age"');
    expect(ord.direction).toBe('desc');

    const val = toSqlValue(sql`${ident('views')} + ${1}`) as SqlValue;
    expect(val.text).toBe('"views" + $1');
    expect(val.values).toEqual([1]);
  });

  it('toString-preview показывает цитируемое имя', () => {
    expect(sql`SELECT ${ident('name')} FROM x`.toString()).toBe(
      'SELECT "name" FROM x',
    );
  });

  it('SelectableField (proxy-реф) рендерится полным идентификатором', () => {
    const field = new SelectableField('User', 'age');
    const c = sql`${field} > ${25}`.compile();
    expect(c.text).toBe('"User"."age" > $1');
    expect(c.values).toEqual([25]);
  });

  it('ident — часть типа SqlPart (type-level, не рендерится значением)', () => {
    const parts: (string | number | IdentMarker)[] = [ident('col'), 1, 'x'];
    expect(parts).toHaveLength(3);
  });
});
