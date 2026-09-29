import { describe, it, expect } from 'vitest';
import { KadmiumSqb } from '../../src/orm/sqb';
import { SelectableField } from '../../src/orm/ast/selectable';
import {
  assertDmlUpdate,
  assertDmlUpdateNoLimit,
  assertDmlUpdateNoOrder,
  assertDmlUpdateNoGroupBy,
  assertDmlDelete,
  assertDmlDeleteNoLimit,
  assertDmlDeleteNoOrder,
  assertDmlDeleteNoGroupBy,
  assertDmlInsert,
  assertDmlInsertNoLimit,
  assertDmlInsertNoOrder,
  assertDmlInsertNoGroupBy,
  assertDmlInsertNoWhere,
  assertSelectAliasKnown,
} from '../../src/orm/guards';
import { makeUserIR } from './helpers';

const userIr = makeUserIR();

/** SQB с where по users.name — база для проверок DML. */
function withWhere(): KadmiumSqb {
  const sqb = new KadmiumSqb();
  sqb.tableContext.set('u', userIr.collection);
  sqb.wheres.elements.push({
    join: 'AND',
    condition: {
      alias: 'u',
      field: 'name',
      column: 'name',
      op: '=',
      value: 'Alice',
    },
  });
  return sqb;
}

function withOrder(): KadmiumSqb {
  const sqb = withWhere();
  sqb.orders.push({
    field: 'name',
    column: 'name',
    tableAlias: 'u',
    direction: 'asc',
  });
  return sqb;
}

function withGroupBy(): KadmiumSqb {
  const sqb = withWhere();
  sqb.groupBy.push({
    kind: 'group-by-column',
    tableAlias: 'u',
    column: 'name',
  });
  return sqb;
}

describe('guards — DML: limit/offset', () => {
  it('update: limit() без offset', () => {
    const sqb = withWhere();
    sqb.limit = 1;
    expect(() => assertDmlUpdateNoLimit(sqb)).toThrow(
      /limit\(\)\/page\(\)\/offset\(\) is not supported with update\(\)/,
    );
  });

  it('update: offset() без limit', () => {
    const sqb = withWhere();
    sqb.offset = 5;
    expect(() => assertDmlUpdateNoLimit(sqb)).toThrow(/not supported/);
  });

  it('update: page() — пишет оба поля, ловится тем же гардом', () => {
    const sqb = withWhere();
    sqb.limit = 10;
    sqb.offset = 20;
    expect(() => assertDmlUpdateNoLimit(sqb)).toThrow(/not supported/);
  });

  it('delete: limit(1).delete() — самая дорогая ошибка, ловится', () => {
    const sqb = withWhere();
    sqb.limit = 1;
    expect(() => assertDmlDeleteNoLimit(sqb)).toThrow(
      /not supported with delete\(\)/,
    );
  });

  it('insert: limit', () => {
    const sqb = new KadmiumSqb();
    sqb.limit = 1;
    expect(() => assertDmlInsertNoLimit(sqb)).toThrow(/not supported/);
  });

  it('чистый sqb без пагинации проходит', () => {
    expect(() => assertDmlUpdateNoLimit(withWhere())).not.toThrow();
    expect(() => assertDmlDeleteNoLimit(withWhere())).not.toThrow();
    expect(() => assertDmlInsertNoLimit(new KadmiumSqb())).not.toThrow();
  });

  it('сообщение называет операцию и подсказку', () => {
    const sqb = withWhere();
    sqb.limit = 1;
    expect(() => assertDmlUpdateNoLimit(sqb)).toThrow(
      /PostgreSQL UPDATE\/DELETE\/INSERT have no LIMIT/,
    );
    expect(() => assertDmlUpdateNoLimit(sqb)).toThrow(/Narrow the rows/);
  });
});

describe('guards — DML: order/cursor', () => {
  it('update: order()', () => {
    expect(() => assertDmlUpdateNoOrder(withOrder())).toThrow(
      /order\(\)\/cursor\(\) is not supported with update\(\)/,
    );
  });

  it('update: cursor() — keyset-пагинация (cursor.elements)', () => {
    const sqb = withWhere();
    sqb.cursor.elements.push({
      join: 'AND',
      condition: { alias: 'u', field: 'id', column: 'id', op: '>', value: 10 },
    });
    expect(() => assertDmlUpdateNoOrder(sqb)).toThrow(/not supported/);
  });

  it('delete: order()', () => {
    expect(() => assertDmlDeleteNoOrder(withOrder())).toThrow(
      /not supported with delete\(\)/,
    );
  });

  it('insert: order()', () => {
    const sqb = new KadmiumSqb();
    sqb.orders.push({
      field: 'name',
      column: 'name',
      tableAlias: 'u',
      direction: 'asc',
    });
    expect(() => assertDmlInsertNoOrder(sqb)).toThrow(/not supported/);
  });

  it('без порядка проходит', () => {
    expect(() => assertDmlUpdateNoOrder(withWhere())).not.toThrow();
    expect(() => assertDmlDeleteNoOrder(withWhere())).not.toThrow();
  });
});

describe('guards — DML: groupBy', () => {
  it('update/delete/insert: groupBy()', () => {
    expect(() => assertDmlUpdateNoGroupBy(withGroupBy())).toThrow(
      /groupBy\(\) is not supported with update\(\)/,
    );
    expect(() => assertDmlDeleteNoGroupBy(withGroupBy())).toThrow(
      /not supported with delete\(\)/,
    );
    expect(() => assertDmlInsertNoGroupBy(withGroupBy())).toThrow(
      /not supported/,
    );
  });

  it('без группировки проходит', () => {
    expect(() => assertDmlUpdateNoGroupBy(withWhere())).not.toThrow();
  });
});

describe('guards — INSERT: where', () => {
  it('where() перед create() — фильтр потерялся бы молча', () => {
    expect(() => assertDmlInsertNoWhere(withWhere())).toThrow(
      /where\(\) is not supported with create\(\).*INSERT has no WHERE clause/s,
    );
  });

  it('сообщение объясняет, что делать вместо этого', () => {
    expect(() => assertDmlInsertNoWhere(withWhere())).toThrow(
      /check the condition in your code/,
    );
  });

  it('чистый insert проходит', () => {
    expect(() => assertDmlInsertNoWhere(new KadmiumSqb())).not.toThrow();
  });
});

describe('guards — пакетные assert-ы', () => {
  it('assertDmlUpdate: порядок вызовов шагов, первое нарушение', () => {
    const sqb = withOrder();
    sqb.limit = 1;
    sqb.groupBy.push({
      kind: 'group-by-column',
      tableAlias: 'u',
      column: 'name',
    });
    // limit проверяется первым — сообщение про limit, а не про groupBy
    expect(() => assertDmlUpdate(sqb)).toThrow(
      /limit\(\)\/page\(\)\/offset\(\) is not supported with update\(\)/,
    );
  });

  it('assertDmlUpdate: без limit первым падает order', () => {
    const sqb = withOrder();
    expect(() => assertDmlUpdate(sqb)).toThrow(
      /order\(\)\/cursor\(\) is not supported with update\(\)/,
    );
  });

  it('assertDmlUpdate/Delete/Insert на чистом sqb не бросают', () => {
    const clean = withWhere();
    expect(() => assertDmlUpdate(clean)).not.toThrow();
    expect(() => assertDmlDelete(clean)).not.toThrow();
    // where запрещён только для INSERT
    expect(() => assertDmlInsert(withWhere())).toThrow(/not supported/);
    expect(() => assertDmlInsert(new KadmiumSqb())).not.toThrow();
  });
});

describe('guards — select: алиас таблицы', () => {
  const known = ['u', 'p'];

  it('алиасы из запроса проходят', () => {
    const items = [
      new SelectableField('u', 'name', undefined, 'name'),
      new SelectableField('p', 'title', undefined, 'title'),
    ];
    expect(() => assertSelectAliasKnown(items, known)).not.toThrow();
  });

  it('опечатка в алиасе ловится в select(), а не в PostgreSQL', () => {
    const items = [new SelectableField('p', 'id', undefined, undefined)];
    expect(() => assertSelectAliasKnown(items, ['u'])).toThrow(
      /Unknown table alias "p" in select\(\)/,
    );
  });

  it('сообщение перечисляет алиасы запроса', () => {
    const items = [new SelectableField('x', 'id', undefined, undefined)];
    expect(() => assertSelectAliasKnown(items, known)).toThrow(
      /Query tables are: u, p\./,
    );
  });

  it('несколько неизвестных алиасов — одно сообщение, без дублей', () => {
    const items = [
      new SelectableField('x', 'id', undefined, undefined),
      new SelectableField('x', 'name', undefined, undefined),
      new SelectableField('y', 'id', undefined, undefined),
    ];
    expect(() => assertSelectAliasKnown(items, known)).toThrow(
      /Unknown table aliases "x", "y" in select\(\)/,
    );
  });

  it('агрегат без алиаса таблицы (пустой tableAlias) пропускается', () => {
    const items = [new SelectableField('', 'count', undefined, 'count')];
    expect(() => assertSelectAliasKnown(items, known)).not.toThrow();
  });

  it('пустой запрос: сообщение не содержит пустого списка таблиц', () => {
    const items = [new SelectableField('u', 'name', undefined, undefined)];
    expect(() => assertSelectAliasKnown(items, [])).toThrow(
      /The query has no tables\./,
    );
  });

  it('принимает Set (irs.keys() из multi) и массив', () => {
    const items = [new SelectableField('p', 'id', undefined, undefined)];
    expect(() => assertSelectAliasKnown(items, new Set(known))).not.toThrow();
  });
});
