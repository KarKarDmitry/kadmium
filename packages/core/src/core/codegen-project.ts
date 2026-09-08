import { AppCore } from './app-core';
import type { ModelIR } from '../ir/index';
import type { KadmiumConfig } from './config';

export const DEFAULT_OUTPUT = '.types/~models.augment.ts';

/** Готовые данные для codegen: модели, пути до их файлов, выходной файл */
export interface CodegenProject {
  config: KadmiumConfig | null;
  irs: ModelIR[];
  modelPaths: Record<string, string>;
  output: string;
}

/**
 * Загрузить проект для codegen: прочитать kadmium.config.ts,
 * импортировать и зарегистрировать модели, построить modelPaths.
 * Используется и CLI (generate/check), и скриптами в scripts/.
 */
export async function loadCodegenProject(
  projectDir: string,
): Promise<CodegenProject> {
  const app = new AppCore();
  await app.loadConfig(projectDir);

  const config = app.config;
  const modelsPath = config?.modelsPath ?? '../src/models';

  const modelPaths: Record<string, string> = {};
  for (const ir of app.allIrs) {
    if (ir.sourceFile) {
      const path = ir.sourceFile.replace(/\\/g, '/').replace(/\.ts$/, '');
      modelPaths[ir.name] = path.startsWith('src/') ? `../${path}` : path;
    } else {
      const file = ir.name.charAt(0).toLowerCase() + ir.name.slice(1);
      modelPaths[ir.name] = `${modelsPath}/${file}`;
    }
  }

  return {
    config,
    irs: app.allIrs,
    modelPaths,
    output: config?.output ?? DEFAULT_OUTPUT,
  };
}
