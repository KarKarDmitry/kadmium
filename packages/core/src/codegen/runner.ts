import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { ModelIR } from '../ir/index';
import { generateModel } from './generate-model';

/**
 * Сгенерировать augment-файл для всех моделей.
 * Собирает все импорты в одном блоке, все declare module подряд,
 * и один export {} в конце — чтобы избежать дубликатов.
 */
export function generateAll(
  irs: ModelIR[],
  modelPaths: Record<string, string>,
): string {
  const allImports = new Set<string>();
  const declBlocks: string[] = [];

  for (const ir of irs) {
    if (!modelPaths[ir.name]) continue;

    // generateModel отдаёт кусок с imports, declare module и export {}
    // Нам нужно: сохранить declare module, а imports собрать отдельно
    const raw = generateModel(ir, modelPaths[ir.name], irs);
    const lines = raw.split('\n');

    // Извлекаем declare module блок
    let inDeclare = false;
    const declLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import ')) {
        allImports.add(trimmed);
      } else if (trimmed.startsWith('declare module')) {
        inDeclare = true;
        declLines.push(line);
      } else if (inDeclare) {
        if (trimmed === 'export {};') {
          inDeclare = false;
        } else {
          declLines.push(line);
        }
      }
    }
    if (declLines.length > 0) declBlocks.push(declLines.join('\n'));
  }

  const importsBlock =
    allImports.size > 0 ? [...allImports].join('\n') + '\n\n' : '';

  const out =
    '// Auto-generated. Do not edit.\n' +
    importsBlock +
    declBlocks.join('\n') +
    '\n\nexport {};\n';

  return out;
}

/**
 * Сгенерировать и записать augment-файл.
 */
export function generateToFile(
  irs: ModelIR[],
  modelPaths: Record<string, string>,
  outputPath: string,
): void {
  if (irs.length === 0) {
    console.warn('⚠️  No models registered. Nothing to generate.');
    return;
  }

  const out = generateAll(irs, modelPaths);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, out, 'utf-8');
  console.log(`\n   → ${outputPath}`);
}

/**
 * Проверить, что сгенерированные типы совпадают с текущим состоянием моделей.
 */
export function checkSync(
  irs: ModelIR[],
  modelPaths: Record<string, string>,
  filePath: string,
): boolean {
  if (irs.length === 0) {
    console.log('⚠️  No models registered. Nothing to check.');
    return true;
  }

  if (!existsSync(filePath)) {
    console.error(`\n  ❌  ${filePath} — file not found.`);
    console.error('\n     Run: npm run generate\n');
    return false;
  }

  const existing = readFileSync(filePath, 'utf-8');
  const expected = generateAll(irs, modelPaths);

  if (existing.trim() !== expected.trim()) {
    console.error(`\n  ❌  ${filePath} — outdated.`);
    console.error('\n     Run: npm run generate\n');
    return false;
  }

  console.log(`✅ Types are up to date (${irs.length} model(s)).`);
  return true;
}
