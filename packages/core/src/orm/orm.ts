import { SingleQueryBuilder } from './builders/single';
import { MultiQueryBuilder } from './builders/multi';
import type { ModelIR } from '../ir/index';
import type { AppCore } from '../core/app-core';
import { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

/**
 * OrmManager — менеджер ORM-запросов, привязанный к AppCore.
 *
 * IR кешируется: модели компилируются один раз при регистрации в AppCore
 * (ModelRegistry), а `single()`/`query()` читают из реестра (O(1)) вместо
 * повторной компиляции на каждый запрос. On-demand компиляция для моделей,
 * которых нет в реестре AppCore, живёт в AppCore (ModelRegistry.compileCount).
 */
export class OrmManager {
  private _irCache = new Map<string, ModelIR | undefined>();
  private _irLookup = (name: string): ModelIR | undefined => {
    const cached = this._irCache.get(name);
    if (cached !== undefined || this._irCache.has(name)) return cached;
    const ir = this.appCore.irByName(name);
    this._irCache.set(name, ir);
    return ir;
  };

  /** Сколько раз IR компилировался on-demand (не из реестра AppCore). */
  get compileCount(): number {
    return this.appCore.compileCount;
  }

  constructor(
    private appCore: AppCore,
    private _txAdapter?: SqlAdapter,
  ) {}

  private get _adapter(): SqlAdapter | undefined {
    return this._txAdapter ?? this.appCore.sqlAdapter;
  }

  /** IR по классу модели: из реестра AppCore, иначе скомпилировать + закешировать. */
  private _irFor(modelClass: { new (): object }): ModelIR {
    const name = modelClass.name;
    const cached = this._irCache.get(name);
    if (cached) return cached;

    const ir = this.appCore.irByClass(modelClass);
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
