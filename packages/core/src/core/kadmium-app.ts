import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import { AppCore } from './app-core';
import { OrmManager } from '../orm/orm';
import { ModuleSlot } from './modules';

/**
 * KadmiumApp — фасад для всего фреймворка.
 *
 * Использование:
 *   const app = new KadmiumApp();
 *   app.modules.sql.set(new PgAdapter({...})); // override до init
 *   await app.init();                            // загружает конфиг
 */
export class KadmiumApp {
  public readonly appCore: AppCore;
  public orm!: OrmManager;
  public modules: {
    sql: ModuleSlot<SqlAdapter>;
  };

  constructor() {
    this.appCore = new AppCore();
    this.modules = {
      sql: new ModuleSlot<SqlAdapter>(),
    };
    // При установке SQL адаптера — прокидываем в AppCore
    this.modules.sql.onSet((adapter) => {
      this.appCore.sqlAdapter = adapter;
    });
  }

  async init(configPath?: string): Promise<this> {
    await this.appCore.loadConfig(configPath);

    // Загружаем модули из конфига, если они ещё не установлены
    const configModules = this.appCore.configModules;
    if (configModules) {
      if (!this.modules.sql.has && configModules.sql) {
        this.modules.sql.set(configModules.sql);
      }
    }

    this.orm = new OrmManager(this.appCore);
    return this;
  }
}

/**
 * Kadmium — предварительно сконфигурированный синглтон.
 * Используется для быстрого старта:
 *   await Kadmium.init();
 *   Kadmium.orm.single(User).select().go();
 */
export const Kadmium = new KadmiumApp();
