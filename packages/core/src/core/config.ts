/**
 * Типы конфигурации kadmium проекта.
 */

import { Dialect, SqlAdapter } from '@karkardmitry/kadmium-sql-types';

export interface KadmiumModules {
  /** SQL адаптер (PgAdapter, SqliteAdapter и т.д.) */
  sql?: SqlAdapter;

  /**
   * Диалект для миграций: имена типов и `DEFAULT`.
   *
   * Отдельно от адаптера, потому что движку диффа нужен только он, а сам
   * адаптер ничего не знает про IR: одно и то же `pgDialect` обслуживает и
   * `PgAdapter`, и любой сторонний адаптер поверх PostgreSQL.
   */
  dialect?: Dialect;
}

export interface KadmiumConfig {
  /** Glob-паттерны для поиска файлов моделей */
  modelSources?: string[];

  /** Путь к выходному файлу augment-типов */
  output?: string;

  /** Путь от выходного файла до src/models */
  modelsPath?: string;

  /** Модули, которые будут установлены в KadmiumApp */
  modules?: KadmiumModules;
}

export function defineConfig(config: KadmiumConfig): KadmiumConfig {
  return config;
}
