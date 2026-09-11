import { compileModel } from '../ir/compile';
import type { CompilableModel } from '../ir/compile';
import { SingleQueryBuilder } from './builders/single';
import { MultiQueryBuilder } from './builders/multi';
import type { ModelIR } from '../ir/index';
import type { AppCore } from '../core/app-core';
import { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

/**
 * Строит irLookup из всех IR, зарегистрированных в AppCore.
 * Кэш разделяется с OrmManager._irCache — единая точка хранения IR.
 */
function buildIrLookup(
  app: AppCore | undefined,
  cache: Map<string, ModelIR | undefined>,
): (name: string) => ModelIR | undefined {
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

    // Fallback: найти класс в реестре AppCore/Model и скомпилировать
    const cls = app?.resolveModelClass(name);
    if (!cls) {
      cache.set(name, undefined);
      return undefined;
    }
    const ir = compileModel(new cls() as unknown as CompilableModel);
    cache.set(name, ir);
    return ir;
  };
}

/**
 * OrmManager — менеджер ORM-запросов, привязанный к AppCore.
 *
 * IR кешируется: модели компилируются один раз при регистрации в AppCore
 * (ModelRegistry), а `single()`/`query()` читают из реестра (O(1)) вместо
 * повторной компиляции на каждый запрос.
 */
export class OrmManager {
  private _irCache = new Map<string, ModelIR | undefined>();
  private _irLookup: (name: string) => ModelIR | undefined;

  /** Сколько раз IR компилировался в горячем пути (не из кеша). */
  public compileCount = 0;

  constructor(
    private appCore: AppCore,
    private _txAdapter?: SqlAdapter,
  ) {
    this._irLookup = buildIrLookup(this.appCore, this._irCache);
  }

  private get _adapter(): SqlAdapter | undefined {
    return this._txAdapter ?? this.appCore.sqlAdapter;
  }

  /** IR по классу модели: из реестра AppCore, иначе скомпилировать + закешировать. */
  private _irFor<TModel>(modelClass: { new (): TModel }): ModelIR {
    const name = modelClass.name;
    const cached = this._irCache.get(name);
    if (cached) return cached;

    try {
      const ir = this.appCore.ir(name);
      this._irCache.set(name, ir);
      return ir;
    } catch {
      // не в реестре — компилируем
    }

    this.compileCount++;
    const ir = compileModel(
      new (modelClass as unknown as new () => CompilableModel)(),
    );
    this._irCache.set(name, ir);
    return ir;
  }

  single<
    TModel extends {
      ['~shape']: Record<string, unknown>;
      ['~rel']: Record<string, unknown>;
      ['~relInfo']: Record<string, unknown>;
    },
  >(modelClass: { new (): TModel }, ir?: ModelIR): SingleQueryBuilder<TModel> {
    const compiled = ir ?? this._irFor(modelClass);
    return new SingleQueryBuilder<TModel>(
      compiled,
      this._irLookup,
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
          ['~relInfo']: Record<string, unknown>;
        };
      };
    },
  >(aliases: T): MultiQueryBuilder<T> {
    const irs = new Map<string, ModelIR>();
    for (const [alias, cls] of Object.entries(aliases)) {
      irs.set(alias, this._irFor(cls as { new (): object }));
    }
    return new MultiQueryBuilder<T>(irs, this._irLookup, this._adapter);
  }

  /**
   * OrmManager с указанным adapter вместо глобального (appCore.sqlAdapter).
   * Общий appCore/registry/IR — меняется только подключение/рендер SQL.
   *
   * @example
   *   app.orm.withAdapter(createDebugAdapter()).single(User).toSql();
   *   app.orm.withAdapter(readReplica).single(User).where(...).go();
   */
  withAdapter(adapter: SqlAdapter): OrmManager {
    return new OrmManager(this.appCore, adapter);
  }
}
