/**
 * `kadmium generate` — CLI command for generating augment types.
 */

import { resolve } from 'path';
import { AppCore, ConfigLoader, ModelImporter } from '../core/index';
import { generateToFile } from '../codegen/index';
import { CHECK, BULLET, WARN, box } from './format';

export async function generateCommand(projectDir: string): Promise<void> {
  // 1. Load config
  const configLoader = new ConfigLoader();
  const config = await configLoader.load(projectDir);

  if (!config || !config.modelSources || config.modelSources.length === 0) {
    console.log('');
    console.log(`  ${WARN}  No model sources configured in kadmium.config.ts.`);
    console.log('');
    return;
  }

  // 2. Import and register models
  const app = new AppCore();
  const importer = new ModelImporter();
  const models = await importer.importModels(
    resolve(projectDir),
    config.modelSources,
    app.registry.sourceFiles,
  );

  if (models.length === 0) {
    console.log('');
    console.log(`  ${WARN}  No Model subclasses found in model files.`);
    console.log('');
    return;
  }

  app.registry.register(models);
  await app.registry.validate();

  // 3. Generate augment
  const output = config.output ?? '.types/~models.augment.ts';
  const modelsPath = config.modelsPath ?? '../src/models';

  const modelPaths: Record<string, string> = {};
  for (const ir of app.allIrs) {
    if (ir.sourceFile) {
      const path = ir.sourceFile.replace(/\.ts$/, '');
      modelPaths[ir.name] = path.startsWith('src/') ? `../${path}` : path;
    } else {
      const file = ir.name.charAt(0).toLowerCase() + ir.name.slice(1);
      modelPaths[ir.name] = `${modelsPath}/${file}`;
    }
  }

  generateToFile(app.allIrs, modelPaths, output);

  console.log('');
  for (const line of box(
    `  ${BULLET}  Generated ${app.modelCount} model augmentation(s)`,
  )) {
    console.log(`  ${line}`);
  }
  console.log('');

  for (const ir of app.allIrs) {
    if (ir.sourceFile) {
      const path = ir.sourceFile.replace(/\.ts$/, '');
      const displayPath = path.startsWith('src/') ? `../${path}` : path;
      console.log(`  ${CHECK}  ${ir.name} \u2190 ${displayPath}`);
    } else {
      const file = ir.name.charAt(0).toLowerCase() + ir.name.slice(1);
      console.log(`  ${CHECK}  ${ir.name} \u2190 ${modelsPath}/${file}`);
    }
  }

  console.log('');
  console.log(`  ${CHECK}  Written to ${output}`);
  console.log('');
}
