import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { CHECK, BULLET, box } from './format';

const TEMPLATES: Record<string, string> = {
  'src/models/index.ts': `import { Model } from 'kadmium';
import { User } from './user';

// Register all application models
Model.register(User);

export { User };
`,

  'src/models/user.ts': `import { Model, f } from 'kadmium';

export class User extends Model {
  email = f.string.unique();
  name = f.string;
}
`,

  'scripts/generate-types.ts': `import { generateToFile } from 'kadmium/src/codegen';
import './src/models';

generateToFile('types/models.d.ts');
`,

  'scripts/check-types.ts': `import { checkSync } from 'kadmium/src/codegen';
import './src/models';

const ok = checkSync('types/models.d.ts');
if (!ok) process.exit(1);
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

  // Create types/ with .gitkeep
  const typesDir = resolve(base, 'types');
  mkdirSync(typesDir, { recursive: true });
  const gitkeep = resolve(typesDir, '.gitkeep');
  if (!existsSync(gitkeep)) {
    writeFileSync(gitkeep, '', 'utf-8');
    console.log(`  ${CHECK}  types/.gitkeep`);
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
  console.log('  \u2514\u2500\u2500 types/');
  console.log('      \u2514\u2500\u2500 models.d.ts        — generated .d.ts');
  console.log('');
  console.log('  Next steps:');
  console.log('  1. npm run generate    — generate .d.ts');
  console.log('  2. npm run check       — verify types');
  console.log('  3. Define your models  — add files to src/models/');
  console.log('');
}
