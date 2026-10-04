import type { FieldIR, ModelIR } from '../ir/index';

/**
 * Заполнит ли БД значение колонки сама — DB-default или autoincrement-PK.
 *
 * Предикат зеркалит `autoIncrement` из `sql-pg` (`diff/types.ts`): тот решает,
 * ставить ли `DEFAULT`/identity в DDL, и типы обязаны считать ровно то же самое,
 * иначе `values()` начнёт требовать поле, которое БД подставит сама.
 *
 * Дублируется, а не импортируется: core не зависит от sql-pg.
 */
function isFilledByDatabase(f: FieldIR): boolean {
  const spec = f.spec as { default?: unknown; db_type?: unknown } | undefined;
  if (spec?.default !== undefined && spec.default !== null) return true;
  const isPrimary = f.isPrimary === true || f.type === 'primary';
  return isPrimary && spec?.db_type !== 'uuid' && spec?.db_type !== 'string';
}

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
  // Поля, которые БД заполняет сама: их не нужно передавать в values().
  // Inverse refs (sourceModel) колонок не имеют — исключаются вместе с ними
  // из ~shape, поэтому и в ~defaults им не место.
  const defaults = fields.filter(
    ([, f]) => !f.sourceModel && isFilledByDatabase(f),
  );

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
        const targetPath = other.sourceFile
          ? (other.sourceFile.startsWith('src/')
              ? `../${other.sourceFile}`
              : other.sourceFile
            )
              .replace(/\\/g, '/')
              .replace(/\.ts$/, '')
          : `${dir}${name.charAt(0).toLowerCase() + name.slice(1)}`;
        importLines.push(`  import { ${name} } from '${targetPath}';`);
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

  // Фантом `~pk` — имя свойства первичного ключа. По нему `findById()`
  // выводит тип аргумента (`PkShape<M>`), поэтому нужен именно ключ
  // модели, а не колонка: колонка может быть переименована через `.alias()`.
  const pk = fields.find(([, f]) => f.isPrimary === true);
  if (pk) {
    lines.push(``);
    lines.push(`  ['~pk']: '${pk[0]}';`);
  }

  if (defaults.length > 0) {
    lines.push(``);
    lines.push(`  ['~defaults']: {`);
    for (const [name, field] of defaults) {
      // Типы те же, что в ~shape: ~defaults — это Pick<~shape, …>.
      const tsType = field.ref ? 'number' : field.tsType;
      lines.push(`    ${name}: ${tsType};`);
    }
    lines.push(`  };`);
  }

  // `~rel`/`~relInfo` эмитятся всегда, даже пустыми: ORM требует их на модели
  // (`select()`/`insert()`), и без них модель без связей не проходит проверку
  // типов после кодогенерации.
  lines.push(``);
  lines.push(`  ['~rel']: {`);
  for (const [name, field] of refs) {
    const target = field.sourceModel ?? field.ref ?? 'unknown';
    const isToMany = !!field.sourceModel && field.relation === 'one-to-many';
    // Forward refs: опциональность из БД. Inverse: to-many всегда массив ([]), to-one — по nullable
    const optional = !field.sourceModel && field.nullable ? '?' : '';
    lines.push(`    ${name}${optional}: ${isToMany ? `${target}[]` : target};`);
  }
  lines.push(`  };`);

  lines.push(``);
  lines.push(`  ['~relInfo']: {`);
  for (const [name, field] of refs) {
    const target = field.sourceModel ?? field.ref ?? 'unknown';
    const kind =
      field.relation === 'one-to-one'
        ? 'one-to-one'
        : field.sourceModel
          ? 'one-to-many'
          : 'many-to-one';
    lines.push(`    ${name}: { target: ${target}; kind: '${kind}' };`);
  }
  lines.push(`  };`);

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
