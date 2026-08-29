import type { ModelIR } from '../ir/index';

/**
 * Сгенерировать augment с `~shape` и `~rel`.
 *
 * @param ir — IR модели
 * @param modulePath — относительный путь от augment-файла до модуля модели
 * @param allIrs — все IR (чтобы собрать imports)
 */
export function generateModel(
  ir: ModelIR,
  modulePath: string,
  allIrs: ModelIR[],
): string {
  const fields = Object.entries(ir.fields);
  const refs = fields.filter(([, f]) => f.type === 'ref');

  // Собираем импорты типов, которые нужны внутри declare module
  const imports = new Set<string>();
  for (const [, field] of fields) {
    if (
      field.tsType &&
      field.tsType !== ir.name &&
      field.tsType !== 'string' &&
      field.tsType !== 'number' &&
      field.tsType !== 'boolean' &&
      field.tsType !== 'Date'
    ) {
      imports.add(field.tsType);
    }
  }

  // Импорты внутри declare module
  const importLines: string[] = [];
  if (imports.size > 0) {
    const sorted = [...imports].sort();
    for (const name of sorted) {
      const other = allIrs.find((m) => m.name === name);
      if (other) {
        const dir = modulePath.includes('/')
          ? modulePath.substring(0, modulePath.lastIndexOf('/') + 1)
          : '';
        importLines.push(
          `  import { ${name} } from '${dir}${name.toLowerCase()}';`,
        );
      }
    }
  }

  const lines: string[] = [];
  lines.push(`  ['~shape']: {`);
  for (const [name, field] of fields) {
    // Inverse refs (sourceModel) — не попадают в ~shape, только в ~rel
    if (field.sourceModel) continue;

    // Forward refs — raw FK тип (number), а не имя модели
    const tsType = field.ref ? 'number' : field.tsType;
    lines.push(
      `    ${name}: ${field.nullable ? `${tsType} | undefined` : tsType};`,
    );
  }
  lines.push(`  };`);

  if (refs.length > 0) {
    lines.push(``);
    lines.push(`  ['~rel']: {`);
    for (const [name, field] of refs) {
      const target = field.sourceModel ?? field.ref ?? 'unknown';
      const isToMany = !!field.sourceModel && field.relation === 'one-to-many';
      // Forward refs: опциональность из БД. Inverse: to-many всегда массив ([]), to-one — по nullable
      const optional = !field.sourceModel && field.nullable ? '?' : '';
      lines.push(
        `    ${name}${optional}: ${isToMany ? `${target}[]` : target};`,
      );
    }
    lines.push(`  };`);
  }

  const body = lines.join('\n');
  const importsBlock =
    importLines.length > 0 ? importLines.join('\n') + '\n\n' : '';

  return (
    `// Auto-generated. Do not edit.\n` +
    importsBlock +
    `declare module '${modulePath}' {\n` +
    `  interface ${ir.name} {\n${body}\n  }\n` +
    `}\n` +
    `\n` +
    `export {};\n`
  );
}
