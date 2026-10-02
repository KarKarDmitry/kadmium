import { describe, it, expect } from 'vitest';
import { assertSinglePrimaryKey, type ModelIR } from '../../src/ir/index';

const field = (over: Partial<ModelIR['fields'][string]> = {}) =>
  ({
    type: 'string',
    tsType: 'string',
    alias: '',
    nullable: false,
    unique: false,
    index: false,
    ...over,
  }) as ModelIR['fields'][string];

const ir = (fields: Record<string, ModelIR['fields'][string]>): ModelIR => ({
  name: 'User',
  collection: 'user',
  fields,
});

describe('assertSinglePrimaryKey', () => {
  it('принимает модель с одним PK', () => {
    expect(() =>
      assertSinglePrimaryKey(
        ir({ id: field({ isPrimary: true }), name: field() }),
      ),
    ).not.toThrow();
  });

  it('принимает модель без PK', () => {
    // Ноль первичных — легально: пользователь мог объявить не-PK поле `id`.
    expect(() => assertSinglePrimaryKey(ir({ id: field() }))).not.toThrow();
  });

  it('принимает пустой набор полей', () => {
    expect(() => assertSinglePrimaryKey(ir({}))).not.toThrow();
  });

  it('бросает на двух PK и перечисляет их', () => {
    const bad = ir({
      id: field({ isPrimary: true }),
      uid: field({ isPrimary: true }),
      name: field(),
    });
    expect(() => assertSinglePrimaryKey(bad)).toThrow(/id, uid/);
  });

  it('считает PK и по типу primary без флага isPrimary', () => {
    // Тот же предикат, что `isPrimaryField()` в sql-pg: рукописный IR может
    // пометить ключ типом, забыв флаг. Проверка только на `isPrimary`
    // пропустила бы ровно этот случай.
    const bad = ir({
      id: field({ isPrimary: true }),
      uid: field({ type: 'primary' }),
    });
    expect(() => assertSinglePrimaryKey(bad)).toThrow(/id, uid/);
  });

  it('три PK тоже отвергаются', () => {
    const bad = ir({
      a: field({ isPrimary: true }),
      b: field({ isPrimary: true }),
      c: field({ isPrimary: true }),
    });
    expect(() => assertSinglePrimaryKey(bad)).toThrow(/a, b, c/);
  });

  it('указывает имя модели в сообщении', () => {
    const bad: ModelIR = {
      name: 'LoginSession',
      collection: 'login_session',
      fields: {
        id: field({ isPrimary: true }),
        uid: field({ isPrimary: true }),
      },
    };
    expect(() => assertSinglePrimaryKey(bad)).toThrow(/Model "LoginSession"/);
  });
});
