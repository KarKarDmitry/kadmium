/**
 * `kadmium check` — CLI command verifying generated augment types
 * match the current state of the models.
 */

import { loadCodegenProject } from '../core/index';
import { checkSync } from '../codegen/index';
import { WARN } from './format';

export async function checkCommand(projectDir: string): Promise<void> {
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

  if (!checkSync(irs, modelPaths, output)) {
    throw new Error('Generated types are outdated.');
  }
}
