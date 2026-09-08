/**
 * `kadmium generate` — CLI command for generating augment types.
 */

import { loadCodegenProject } from '../core/index';
import { generateToFile } from '../codegen/index';
import { CHECK, BULLET, WARN, box } from './format';

export async function generateCommand(projectDir: string): Promise<void> {
  const { config, irs, modelPaths, output } =
    await loadCodegenProject(projectDir);

  if (!config || !config.modelSources || config.modelSources.length === 0) {
    console.log('');
    console.log(`  ${WARN}  No model sources configured in kadmium.config.ts.`);
    console.log('');
    return;
  }

  if (irs.length === 0) {
    console.log('');
    console.log(`  ${WARN}  No Model subclasses found in model files.`);
    console.log('');
    return;
  }

  generateToFile(irs, modelPaths, output);

  console.log('');
  for (const line of box(
    `  ${BULLET}  Generated ${irs.length} model augmentation(s)`,
  )) {
    console.log(`  ${line}`);
  }
  console.log('');

  for (const ir of irs) {
    console.log(`  ${CHECK}  ${ir.name} \u2190 ${modelPaths[ir.name]}`);
  }

  console.log('');
  console.log(`  ${CHECK}  Written to ${output}`);
  console.log('');
}
