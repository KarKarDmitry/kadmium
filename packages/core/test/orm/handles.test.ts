import { describe, it, expect } from 'vitest';
import { SingleQueryBuilder } from '../../src/orm/builders/single';
import type {
  DmlConfigHandle,
  SingleConfigHandle,
  SingleCursorBranch,
} from '../../src/orm/builders/handles';
import { makeUserIR } from './helpers';

type UserM = {
  ['~shape']: { id: number; name: string; age: number | null; active: boolean };
  ['~rel']: Record<string, unknown>;
  ['~relInfo']: Record<string, unknown>;
};

/** Входная ветка single, как её отдаёт orm.single(). */
function config(): DmlConfigHandle<UserM> {
  return new SingleQueryBuilder<UserM>(
    makeUserIR(),
  ) as unknown as DmlConfigHandle<UserM>;
}

describe('handles — narrowing (ветки ловят порядковые ловушки на типах)', () => {
  it('config: cursor() недоступен до order()', () => {
    const b = config();
    b.where((u: any) => u.name.eq('Alice'));
    // @ts-expect-error — cursor() требует order(): нет на SingleConfigHandle
    expect(() => b.cursor((u: any) => u.id.gt(1))).toThrow(/requires an order/);
    expect(b.sqb.wheres.elements.length).toBe(1);
  });

  it('ordering → cursor: ветки, offset()/page()/cursor() недоступны', () => {
    const b = config();
    const cur: SingleCursorBranch<UserM> = b
      .order((u: any) => [u.id.asc])
      .cursor((u: any) => u.id.gt(1));
    // методы SingleShared остаются на всех ветках
    cur.limit(2).where((u: any) => u.active.eq(true));
    // @ts-expect-error — cursor() уже установлен: нет на SingleCursorBranch
    expect(() => cur.cursor((u: any) => u.id.gt(2))).toThrow(/already set/);
    // @ts-expect-error — SingleCursorBranch не имеет offset()
    expect(() => cur.offset(5)).toThrow(/cannot be combined/);
    // @ts-expect-error — SingleCursorBranch не имеет page()
    expect(() => cur.page(2, 10)).toThrow(/cannot be combined/);
    expect(cur.sqb.cursor.elements.length).toBe(1);
  });

  it('ordering → page: page() разоружает ветку в конфиг (теряется курсор)', () => {
    const b = config();
    const after = b.order((u: any) => [u.id.asc]).page(2, 10);
    // @ts-expect-error — после page() курсор недоступен (вернулся SingleConfigHandle)
    expect(() => after.cursor((u: any) => u.id.gt(1))).toThrow(
      /cannot be combined/,
    );
    expect(after.sqb.limit).toBe(10);
  });

  it('ordering → offset: offset() тоже разоружает ветку', () => {
    const b = config();
    const after = b.order((u: any) => [u.id.asc]).offset(5);
    // @ts-expect-error — после offset() курсор недоступен (вернулся SingleConfigHandle)
    expect(() => after.cursor((u: any) => u.id.gt(1))).toThrow(
      /cannot be combined/,
    );
    expect(after.sqb.offset).toBe(5);
  });
});

/**
 * DML-сужение. `orm.single()` отдаёт DmlConfigHandle = конфиг-ветка + DML.
 * sql-pg строит UPDATE/DELETE/INSERT только из данных и wheres, поэтому любой
 * шаг, который в DML не рендерится, снимает DML-методы с типа.
 *
 * Тесты двухуровневые и проверяют оба слоя сразу: `@ts-expect-error` — сужение
 * на типах (упадёт, если откатят), `toThrow` — runtime-гард. Компилятор ловит
 * раньше, гард остаётся defense-in-depth для JS, динамики и обхода типов.
 *
 * Сужение убирает метод с ТИПА, но не из класса: тело update() физически на
 * месте. Поэтому «не бросило» означало бы «гард сломан», а не «сужение есть».
 * Последний тест — контрпример: сужение снято только типом, ломающих шагов
 * нет, поэтому и гард молчит.
 */
describe('handles — DML сужается шагами, которые не рендерятся в DML', () => {
  const dml = { name: 'Alice' } as const;
  const ORDER = /order\(\)\/cursor\(\) is not supported with update\(\)/;
  const PAGE =
    /limit\(\)\/page\(\)\/offset\(\) is not supported with update\(\)/;
  const DEL_PAGE =
    /limit\(\)\/page\(\)\/offset\(\) is not supported with delete\(\)/;

  it('на входе DML доступен и гард молчит', () => {
    const b = config();
    expect(() => b.update(dml)).not.toThrow();
    expect(() => b.delete()).not.toThrow();
    // билдер не мутирован: операция живёт в снапшоте финализатора
    expect(b.sqb.operation).toBe('select');
  });

  it('where()/clone() DML НЕ снимают — фильтр в DML нужен', () => {
    const after = config()
      .where((u: any) => u.active.eq(true))
      .clone();
    expect(() => after.update(dml)).not.toThrow();
    expect(after.sqb.wheres.elements.length).toBe(1);
  });

  it('limit() снимает DML, гард ловит', () => {
    const after = config().limit(1);
    // @ts-expect-error — limit не рендерится в DML, метода нет на типе
    expect(() => after.update(dml)).toThrow(PAGE);
    // @ts-expect-error — то же для delete
    expect(() => after.delete()).toThrow(DEL_PAGE);
    expect(after.sqb.limit).toBe(1);
  });

  it('offset() и page() снимают DML', () => {
    const b = config();
    // @ts-expect-error — offset не рендерится в DML
    expect(() => b.offset(5).update(dml)).toThrow(PAGE);
    // @ts-expect-error — page не рендерится в DML
    expect(() => b.page(2, 10).delete()).toThrow(DEL_PAGE);
  });

  it('order() снимает DML (и offset() его не возвращает)', () => {
    const ordered = config().order((u: any) => [u.id.asc]);
    // @ts-expect-error — order не рендерится в DML
    expect(() => ordered.update(dml)).toThrow(ORDER);
    // @ts-expect-error — offset() возвращает голый конфиг, DML не возвращается
    expect(() => ordered.offset(5).delete()).toThrow(DEL_PAGE);
    expect(ordered.sqb.orders.length).toBe(1);
  });

  it('cursor() снимает DML; limit() в cursor-ветке тоже', () => {
    const cur: SingleCursorBranch<UserM> = config()
      .order((u: any) => [u.id.asc])
      .cursor((u: any) => u.id.gt(1));
    // @ts-expect-error — cursor не рендерится в DML
    expect(() => cur.update(dml)).toThrow(ORDER);
    // @ts-expect-error — limit() из cursor-ветки ведёт в конфиг без DML
    expect(() => cur.limit(2).delete()).toThrow(DEL_PAGE);
  });

  it('groupBy() DML НЕ снимает: сужения нет, ловит только runtime-гард', () => {
    const after = config().groupBy((u: any) => [u.name]);
    // Без @ts-expect-error, и это осознанно: groupBy(): this в SingleShared,
    // сузить его значило бы сломать ветку для всех вызывающих. Единственный
    // ловец — assertDmlUpdateNoGroupBy; это единственный не-сужённый кейс.
    expect(() => after.update(dml)).toThrow(
      /groupBy\(\) is not supported with update\(\)/,
    );
    expect(after.sqb.groupBy.length).toBe(1);
  });

  it('сужение не протекает: за базовым SingleConfigHandle DML нет', () => {
    const plain: SingleConfigHandle<UserM> = config();
    // @ts-expect-error — базовый конфиг без DML-методов
    expect(() => plain.update(dml)).not.toThrow();
  });
});
