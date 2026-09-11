import { Model, ModelClass } from '../model/index';
import { compileModel } from '../ir/compile';
import type { ModelIR } from '../ir/index';
import { notFound } from './errors';

/**
 * ModelRegistry — регистрация, компиляция IR, кеш, валидация.
 */
export class ModelRegistry {
  private irs = new Map<string, ModelIR>();
  private _initialized = false;

  /** Пути к исходным файлам моделей { className → filePath } */
  sourceFiles: Record<string, string> = {};

  /**
   * Зарегистрировать модели, скомпилировать IR.
   */
  register(models: ModelClass[]): this {
    Model.register(...models);
    for (const ModelClass of models) {
      const instance = new (ModelClass as new () => Model)();
      const sourceFile = this.sourceFiles[ModelClass.name];
      const ir = compileModel(instance, sourceFile);
      this.irs.set(ir.name, ir);
    }
    return this;
  }

  /** Получить IR по имени модели */
  ir(name: string): ModelIR {
    const ir = this.irs.get(name);
    if (!ir) throw notFound('Model', name);
    return ir;
  }

  /** Получить IR по классу модели */
  irOf(modelClass: ModelClass): ModelIR {
    return this.ir(modelClass.name);
  }

  /** Найти класс модели по имени (делегирует в глобальный реестр Model). */
  resolveModelClass(name: string): ModelClass | undefined {
    return Model.resolve(name);
  }

  /** Все IR */
  get allIrs(): ModelIR[] {
    return [...this.irs.values()];
  }

  /** Количество моделей */
  get modelCount(): number {
    return this.irs.size;
  }

  /** Валидация целостности ref-ссылок */
  async validate(): Promise<void> {
    if (this._initialized) return;
    for (const [, ir] of this.irs) {
      for (const [fieldName, field] of Object.entries(ir.fields)) {
        if (field.ref && !this.irs.has(field.ref)) {
          console.warn(
            `[AppCore] ${ir.name}.${fieldName}: ref to "${field.ref}" — model not registered.`,
          );
        }
      }
    }
    this._initialized = true;
  }
}
