import { describe, it, expect } from 'vitest';
import { SingleQueryBuilder } from '../../src/orm/builders/single';
import type {
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
function config(): SingleConfigHandle<UserM> {
  return new SingleQueryBuilder<UserM>(
    makeUserIR(),
  ) as unknown as SingleConfigHandle<UserM>;
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
