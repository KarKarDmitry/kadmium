import { compileModel } from '../ir/compile';
import { SingleQueryBuilder } from './builders/single';
import { MultiQueryBuilder } from './builders/multi';
import { Model } from '../model/index';
import type { ModelIR } from '../ir/index';
import type { AppCore } from '../core/app-core';
import { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

/**
 * Строит irLookup из всех IR, зарегистрированных в AppCore.
 */
function buildIrLookup(app?: AppCore): (name: string) => ModelIR | undefined {
  const cache = new Map<string, ModelIR | undefined>();
  return (name: string) => {
    const cached = cache.get(name);
    if (cached !== undefined || cache.has(name)) return cached;

    if (app) {
      try {
        const ir = app.ir(name);
        cache.set(name, ir);
        return ir;
      } catch {
        // не найдено — продолжим
      }
    }

    // Fallback: найти класс в реестре Model и скомпилировать
    const cls = Model.resolve(name);
    if (!cls) {
      cache.set(name, undefined);
      return undefined;
    }
    const ir = compileModel(new cls() as Model);
    cache.set(name, ir);
    return ir;
  };
}

/**
 * OrmManager — менеджер ORM-запросов, привязанный к AppCore.
 */
export class OrmManager {
  constructor(
    private appCore: AppCore,
    private _txAdapter?: SqlAdapter,
  ) {}

  private get _adapter(): SqlAdapter | undefined {
    return this._txAdapter ?? this.appCore.sqlAdapter;
  }

  single<
    TModel extends {
      ['~shape']: Record<string, unknown>;
      ['~rel']: Record<string, unknown>;
    },
  >(modelClass: { new (): TModel }, ir?: ModelIR): SingleQueryBuilder<TModel> {
    const instance = new (modelClass as unknown as { new (): Model })();
    const compiled = ir ?? compileModel(instance);
    return new SingleQueryBuilder<TModel>(
      compiled,
      buildIrLookup(this.appCore),
      this._adapter,
    );
  }

  /**
   * Выполнить операции в транзакции.
   * При успехе — commit, при ошибке — rollback.
   */
  async transaction<R>(callback: (tx: OrmManager) => Promise<R>): Promise<R> {
    const adapter = this._adapter;
    if (!adapter) throw new Error('No SQL adapter configured for transactions');

    const txAdapter = await adapter.beginTransaction();
    const txOrm = new OrmManager(this.appCore, txAdapter);

    try {
      const result = await callback(txOrm);
      await txAdapter.commit();
      return result;
    } catch (err) {
      await txAdapter.rollback();
      throw err;
    } finally {
      await txAdapter.end();
    }
  }

  /**
   * Создать многотабличный запрос.
   * @example app.orm.query({ u: User, p: Post })
   */
  query<
    T extends {
      [K in keyof T & string]: {
        new (): {
          ['~shape']: Record<string, unknown>;
          ['~rel']: Record<string, unknown>;
        };
      };
    },
  >(aliases: T): MultiQueryBuilder<T> {
    const irs = new Map<string, ModelIR>();
    for (const [alias, cls] of Object.entries(aliases)) {
      const instance = new (cls as unknown as { new (): Model })();
      const ir = compileModel(instance);
      irs.set(alias, ir);
    }
    return new MultiQueryBuilder<T>(
      irs,
      buildIrLookup(this.appCore),
      this._adapter,
    );
  }
}

/**
 * Автономный orm — без AppCore (irLookup только через Model.resolve).
 */
export const orm = {
  single<
    TModel extends {
      ['~shape']: Record<string, unknown>;
      ['~rel']: Record<string, unknown>;
    },
  >(modelClass: { new (): TModel }, ir?: ModelIR): SingleQueryBuilder<TModel> {
    const instance = new (modelClass as unknown as { new (): Model })();
    const compiled = ir ?? compileModel(instance);
    return new SingleQueryBuilder<TModel>(compiled, buildIrLookup());
  },
};
