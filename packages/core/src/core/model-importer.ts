import { globSync } from 'fs';
import { relative, resolve } from 'path';
import { ModelClass } from '../model/index';

const MODEL_MARKER = Symbol.for('kadmium:model');

/**
 * ModelImporter — обход ФС по glob, динамический импорт, фильтрация моделей.
 */
export class ModelImporter {
  /**
   * Сканировать modelSources, импортировать файлы, вернуть список моделей.
   * @param projectDir — корень проекта
   * @param modelSources — glob-паттерны для поиска файлов моделей
   * @param sourceFiles — (output) map { className → относительный путь к файлу }
   */
  async importModels(
    projectDir: string,
    modelSources: string[],
    sourceFiles: Record<string, string>,
  ): Promise<ModelClass[]> {
    const files: string[] = [];
    for (const pattern of modelSources) {
      const matches = globSync(pattern, { cwd: projectDir });
      for (const f of matches) files.push(resolve(projectDir, f));
    }

    const models: ModelClass[] = [];

    for (const file of files) {
      const mod = await import(file);
      for (const [exportedName, exported] of Object.entries(mod)) {
        if (typeof exported === 'function' && this._isModelClass(exported)) {
          models.push(exported as ModelClass);
          // Всегда относительный путь с прямыми слэшами (переносимо на Windows)
          const relPath = relative(projectDir, file).replace(/\\/g, '/');
          if (
            !sourceFiles[exportedName] ||
            (sourceFiles[exportedName].endsWith('/index.ts') &&
              !relPath.endsWith('/index.ts'))
          ) {
            sourceFiles[exportedName] = relPath;
          }
        }
      }
    }

    return models;
  }

  private _isModelClass(fn: unknown): boolean {
    return (
      typeof fn === 'function' &&
      (fn as unknown as Record<symbol, boolean>)[MODEL_MARKER] === true
    );
  }
}
