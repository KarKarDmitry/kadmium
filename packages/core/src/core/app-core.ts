import { resolve } from 'path';
import { ModelClass } from '../model/index';
import type { ModelIR } from '../ir/index';
import type { KadmiumConfig, KadmiumModules } from './config';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import { ConfigLoader } from './config-loader';
import { ModelImporter } from './model-importer';
import { ModelRegistry } from './model-registry';

/**
 * AppCore — фасад ядра приложения.
 * Делегирует ConfigLoader (конфиг), ModelImporter (сканирование/импорт),
 * ModelRegistry (регистрация/IR/валидация).
 */
export class AppCore {
  readonly configLoader = new ConfigLoader();
  readonly modelImporter = new ModelImporter();
  readonly registry = new ModelRegistry();

  config: KadmiumConfig | null = null;
  configModules: KadmiumModules | null = null;
  sqlAdapter?: SqlAdapter;

  static async init(configPath?: string): Promise<AppCore> {
    const app = new AppCore();
    await app.loadConfig(configPath);
    return app;
  }

  async loadConfig(configPath?: string): Promise<this> {
    const projectDir = resolve(configPath ?? '.');
    const config = await this.configLoader.load(projectDir);
    if (!config) return this;
    this.config = config;
    this.configModules = config.modules ?? null;

    const models = await this.modelImporter.importModels(
      projectDir,
      config.modelSources ?? ['src/models/**/*.ts'],
      this.registry.sourceFiles,
    );

    if (models.length > 0) {
      this.registry.register(models);
    }

    await this.registry.validate();
    return this;
  }

  /** IR по имени модели */
  ir(name: string): ModelIR {
    return this.registry.ir(name);
  }

  irOf(modelClass: ModelClass): ModelIR {
    return this.registry.irOf(modelClass);
  }

  get allIrs(): ModelIR[] {
    return this.registry.allIrs;
  }

  get modelCount(): number {
    return this.registry.modelCount;
  }

  /** Зарегистрировать модели напрямую (без сканирования) */
  register(models: ModelClass[]): this {
    this.registry.register(models);
    return this;
  }
}
