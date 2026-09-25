import { describe, it, expect } from 'vitest';
import { sql } from '../../src/orm/sql-fragment';
import { SelectableField } from '../../src/orm/ast/selectable';
import { SingleQueryBuilder } from '../../src/orm/builders/single';
import type {
  SqlSelectItem,
  SqlAdapter,
} from '@karkardmitry/kadmium-sql-types';
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

describe('single select — sql-фрагмент в SELECT', () => {
  it('встраивает фрагмент с .as() через колбек (прокси-поле инлайнится идентификатором)', () => {
    const b = builder();
    b.select((u: any) => [
      u.id,
      sql<number>`EXTRACT(YEAR FROM ${u.registeredAt})`.as('year'),
    ]);
    const sel = b.sqb.selects!;
    expect(sel).toHaveLength(2);
    expect(sel[0]).toMatchObject({
      kind: 'selectable',
      tableAlias: 'User',
      fieldName: 'id',
    });
    expect(sel[1]).toMatchObject({
      kind: 'sql-item',
      alias: 'year',
      text: 'EXTRACT(YEAR FROM "User"."registered_at")',
      values: [],
      slotOrder: [],
    });
  });

  it('принимает готовый список элементов без колбека', () => {
    const b = builder();
    b.select([
      new SelectableField('User', 'id'),
      sql<number>`EXTRACT(YEAR FROM now())`.as('year'),
    ]);
    const sel = b.sqb.selects!;
    expect(sel).toHaveLength(2);
    expect(sel[0]).toMatchObject({ kind: 'selectable' });
    expect(sel[1]).toMatchObject({ kind: 'sql-item', alias: 'year' });
  });

  it('принимает один элемент без колбека', () => {
    const b = builder();
    b.select(sql<number>`EXTRACT(YEAR FROM now())`.as('year'));
    const sel = b.sqb.selects!;
    expect(sel).toHaveLength(1);
    expect((sel[0] as SqlSelectItem).alias).toBe('year');
  });

  it('first() принимает элементы и ставит limit 1', () => {
    const b = builder();
    b.first(sql<number>`EXTRACT(YEAR FROM now())`.as('year'));
    expect(b.sqb.selects).toHaveLength(1);
    expect(b.sqb.limit).toBe(1);
  });

  it('select() без аргументов не ломается', () => {
    const b = builder();
    b.select();
    expect(b.sqb.selects!.length).toBe(3);
  });

  it('select(items) доезжает до adapter.toSql', () => {
    const adapter = makeMockAdapter();
    const b = builder(adapter);
    b.select(sql<number>`EXTRACT(YEAR FROM now())`.as('year'));
    b.toSql();
    expect(adapter.toSql).toHaveBeenCalledTimes(1);
    const got = adapter.toSql.mock.calls[0][0] as {
      selects: readonly unknown[] | null;
    };
    expect(got.selects?.length).toBe(1);
    expect((got.selects![0] as SqlSelectItem).alias).toBe('year');
  });
});
