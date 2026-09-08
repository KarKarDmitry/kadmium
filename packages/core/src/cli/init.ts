import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { CHECK, BULLET, box } from './format';

const TEMPLATES: Record<string, string> = {
  'kadmium.config.ts': `import { defineConfig } from 'kadmium';

export default defineConfig({
  modelSources: ['src/models/**/*.ts'],
  output: '.types/~models.augment.ts',
  modelsPath: '../src/models',
});
`,

  'src/models/index.ts': `import { Model } from 'kadmium';
import { User } from './user';

// Register all application models
Model.register(User);

export { User };
`,

  'src/models/user.ts': `import { Model, f } from 'kadmium';

export class User extends Model {
  name = f.string;
  email = f.string.unique();
}
`,

  'scripts/generate-types.ts': `import { loadCodegenProject, generateToFile } from 'kadmium';

async function main(): Promise<void> {
  const { irs, modelPaths, output } = await loadCodegenProject(process.cwd());
  generateToFile(irs, modelPaths, output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`,

  'scripts/check-types.ts': `import { loadCodegenProject, checkSync } from 'kadmium';

async function main(): Promise<void> {
  const { irs, modelPaths, output } = await loadCodegenProject(process.cwd());
  if (!checkSync(irs, modelPaths, output)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`,
};

const PACKAGE_SCRIPTS: Record<string, string> = {
  generate: 'ts-node scripts/generate-types.ts',
  check: 'ts-node scripts/check-types.ts',
};

export function init(projectDir: string): void {
  const base = resolve(projectDir);

  console.log('');
  for (const line of box(`  ${BULLET}  Initializing kadmium project`)) {
    console.log(`  ${line}`);
  }
  console.log('');

  // Create files
  for (const [filePath, content] of Object.entries(TEMPLATES)) {
    const fullPath = resolve(base, filePath);
    const dir = resolve(fullPath, '..');

    mkdirSync(dir, { recursive: true });

    if (existsSync(fullPath)) {
      console.log(`  ${CHECK}  ${filePath} — already exists, skipped`);
      continue;
    }

    writeFileSync(fullPath, content, 'utf-8');
    console.log(`  ${CHECK}  ${filePath}`);
  }

  // Create .types/ with .gitkeep
  const typesDir = resolve(base, '.types');
  mkdirSync(typesDir, { recursive: true });
  const gitkeep = resolve(typesDir, '.gitkeep');
  if (!existsSync(gitkeep)) {
    writeFileSync(gitkeep, '', 'utf-8');
    console.log(`  ${CHECK}  .types/.gitkeep`);
  }

  // Add scripts to package.json
  const pkgPath = resolve(base, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    pkg.scripts = pkg.scripts ?? {};
    let changed = false;

    for (const [name, script] of Object.entries(PACKAGE_SCRIPTS)) {
      if (!pkg.scripts[name]) {
        pkg.scripts[name] = script;
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      console.log(`  ${CHECK}  package.json scripts updated`);
    }
  }

  console.log('');
  for (const line of box(`  ${BULLET}  Project structure`)) {
    console.log(`  ${line}`);
  }
  console.log('');
  console.log(`  ${base}/`);
  console.log('  \u251c\u2500\u2500 kadmium.config.ts — model sources, output');
  console.log('  \u251c\u2500\u2500 src/models/');
  console.log(
    '  \u2502   \u251c\u2500\u2500 index.ts    — barrel + Model.register()',
  );
  console.log('  \u2502   \u2514\u2500\u2500 user.ts     — example model');
  console.log('  \u251c\u2500\u2500 scripts/');
  console.log(
    '  \u2502   \u251c\u2500\u2500 generate-types.ts  — npm run generate',
  );
  console.log(
    '  \u2502   \u2514\u2500\u2500 check-types.ts     — npm run check',
  );
  console.log('  \u2514\u2500\u2500 .types/');
  console.log(
    '      \u2514\u2500\u2500 ~models.augment.ts  — generated augment',
  );
  console.log('');
  console.log('  Next steps:');
  console.log('  1. npm install kadmium ts-node');
  console.log('  2. npm run generate    — generate augment types');
  console.log('  3. npm run check       — verify types');
  console.log('  4. Define your models  — add files to src/models/');
  console.log('');
}
