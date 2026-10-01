import { describe, it, expect } from 'vitest';
import { SelectQueryBuilder } from '../../src/orm/builders/select';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { ModelIR } from '../../src/ir/index';
import { makeMockAdapter, type MockAdapter } from './helpers';

/**
 * Модель с нестандартными именами: PK — `uid`, колонка `display_name`.
 * `findById()` обязан опираться на `isPrimary`, а не на имя `id`.
 */
const ACCOUNT_IR: ModelIR = {
  name: 'Account',
  collection: 'accounts',
  fields: {
    uid: {
      type: 'bigint',
      alias: 'uid',
      tsType: 'number',
      nullable: false,
      unique: true,
      index: false,
      isPrimary: true,
    },
    handle: {
      type: 'string',
      alias: 'display_name',
      tsType: 'string',
      nullable: false,
      unique: false,
      index: false,
    },
    bio: {
      type: 'string',
      alias: 'bio',
      tsType: 'string',
      nullable: true,
      unique: false,
      index: false,
    },
  },
};

const NO_PK_IR: ModelIR = {
  name: 'Session',
  collection: 'sessions',
  fields: {
    token: {
      type: 'string',
      alias: 'token',
      tsType: 'string',
      nullable: false,
      unique: true,
      index: false,
    },
  },
};

/**
 * Тип модели для билдера: без него `~shape` деградирует до `unknown`, и
 * фильтры теряют `eq`/`.asc()` — тест проверял бы не то.
 */
interface Account {
  ['~shape']: {
    uid: number;
    handle: string;
    bio: string | undefined;
  };
  ['~rel']: Record<string, never>;
  ['~relInfo']: Record<string, never>;
}

function builder(adapter?: MockAdapter) {
  return new SelectQueryBuilder<Account>(
    ACCOUNT_IR,
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

describe('SelectQueryBuilder — findById', () => {
  it('кидает No primary key field found, если isPrimary не задан', () => {
    const b = new SelectQueryBuilder<Account>(NO_PK_IR);
    expect(() => b.findById(1)).toThrow('No primary key field found');
  });

  it('фильтрует по PK и переходит в first: limit=1 и один элемент wheres', () => {
    const b = builder();
    b.findById(42);
    expect(b.sqb.limit).toBe(1);
    expect(b.sqb.wheres.elements).toHaveLength(1);
  });

  it('PK находится по isPrimary, а не по имени — колонка uid, не id', () => {
    const b = builder();
    b.findById(42);
    expect(b.sqb.wheres.elements[0]).toEqual({
      join: 'AND',
      condition: {
        alias: 'Account',
        field: 'uid',
        column: 'uid',
        op: '=',
        value: 42,
      },
    });
  });

  it('ссылка квалифицируется АЛИАСОМ колонки, а не именем поля', () => {
    // `handle` → `display_name`: findById по PK этого не касается, но
    // регрессия на алиасах здесь же и ловится — фильтр строится тем же proxy.
    const b = builder();
    b.where((a) => a.handle.eq('bob'));
    expect(b.sqb.wheres.elements[0]).toEqual({
      join: 'AND',
      condition: {
        alias: 'Account',
        field: 'handle',
        column: 'display_name',
        op: '=',
        value: 'bob',
      },
    });
  });

  it('go() в first-режиме возвращает одну запись, а не массив', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValueOnce([{ uid: 42, handle: 'bob' }]);

    const found = await builder(adapter).findById(42).go();

    expect(found).toEqual({ uid: 42, handle: 'bob' });
    expect(Array.isArray(found)).toBe(false);
  });

  it('не найденная запись даёт undefined, а не []', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValueOnce([]);

    const found = await builder(adapter).findById(999).go();

    expect(found).toBeUndefined();
  });

  it('сохраняет уже набранные условия — findById добавляет AND, а не затирает', () => {
    const b = builder();
    b.where((a) => a.bio.eq('x'));
    b.findById(42);
    expect(b.sqb.wheres.elements).toHaveLength(2);
  });

  it('clone() не делит условия с оригиналом', () => {
    const b = builder();
    const c = b.clone();
    c.findById(42);
    expect(b.sqb.wheres.elements).toHaveLength(0);
    expect(c.sqb.wheres.elements).toHaveLength(1);
  });
});
