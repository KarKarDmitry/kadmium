/**
 * Типы конфигурации kadmium проекта.
 */

import { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

export interface KadmiumModules {
  /** SQL адаптер (PgAdapter, SqliteAdapter и т.д.) */
  sql?: SqlAdapter;
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
