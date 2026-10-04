/**
 * IR → ожидаемые объекты БД: колонки, индексы, внешние ключи.
 *
 * Диалект-независимо, кроме одного места: имя SQL-типа и текст `DEFAULT`
 * приходят из `Dialect`. Всё остальное — правила самой схемы, одинаковые для
 * любой базы: уникальность выражается индексом, `one-to-one` — это уникальный
 * индекс на колонке, отсутствие `onDelete()` означает `NO ACTION`.
 */

import type {
  DbColumn,
  DbForeignKey,
  DbIndex,
  Dialect,
  IrField,
  IrModel,
} from '@karkardmitry/kadmium-sql-types';

export function isPrimaryField(f: IrField): boolean {
  return f.isPrimary === true || f.type === 'primary';
}

/**
 * PK, который PostgreSQL наполняет сам — `serial`/`bigserial`.
 *
 * Единый предикат для `irToColumns()` и `computeDiff()`: расходиться они не
 * должны, потому что от него зависит, чей дефолт — наш или базы. У
 * autoIncrement-колонки дефолт принадлежит последовательности (`nextval(...)`),
 * а не модели, и сравнивать его с `renderDefault()` нельзя.
 */
export function isAutoIncrementField(f: IrField): boolean {
  return (
    isPrimaryField(f) &&
    f.spec?.db_type !== 'uuid' &&
    f.spec?.db_type !== 'string'
  );
}

export function irToColumns(
  tableName: string,
  irFields: Record<string, IrField>,
  irs: readonly IrModel[],
  dialect: Dialect,
): DbColumn[] {
  // Два первичных ключа дают два `PRIMARY KEY` инлайн в CREATE TABLE, и
  // PostgreSQL отвечает `42710 multiple primary keys are not allowed` —
  // сообщение про эту колонку ничего не говорит. Ловим здесь, где IR
  // превращается в колонки, а не полагаемся на `compileModel()`: `ModelIR` —
  // публичный контракт, и IR можно собрать руками и отдать прямо в
  // `computeDiff()`. Модели, собранные через `Model`, до сюда не доходят с
  // двумя ключами — их ловит `assertSinglePrimaryKey()` в core.
  const primaryFields = Object.entries(irFields).filter(([, f]) =>
    isPrimaryField(f),
  );
  if (primaryFields.length > 1) {
    throw new Error(
      `Model "${tableName}": объявлено несколько primary-ключей — ${primaryFields
        .map(([name]) => name)
        .join(', ')}. Первичный ключ должен быть один.`,
    );
  }

  return Object.entries(irFields)
    .filter(([, f]) => !f.sourceModel)
    .map(([name, f]) => ({
      name: f.alias ?? name,
      tableName,
      dataType: dialect.typeName(f, irs),
      isNullable: f.nullable && !isPrimaryField(f),
      defaultValue: dialect.renderDefault(f),
      isPrimary: isPrimaryField(f),
      isUnique: f.unique || isPrimaryField(f),
      autoIncrement: isAutoIncrementField(f),
    }));
}

export function expectedIndexes(
  tableName: string,
  irFields: Record<string, IrField>,
): DbIndex[] {
  const indexes: DbIndex[] = [];
  for (const [name, f] of Object.entries(irFields)) {
    if (f.sourceModel || isPrimaryField(f)) continue;
    // Ref fields automatically get an index
    if (f.unique || f.index || f.type === 'ref') {
      indexes.push({
        name: `idx_${tableName}_${f.alias ?? name}`,
        tableName,
        columns: [f.alias ?? name],
        // `one-to-one` означает «на одну запись цели приходится ровно одна
        // моя», а это и есть уникальность. Имя индекса у `.unique()`-поля и
        // у обычного ref-поля совпадает, поэтому проверять тут же — иначе
        // пользователю пришлось бы дублировать намерение через `.unique()`.
        isUnique: !!f.unique || f.relation === 'one-to-one',
      });
    }
  }
  return indexes;
}

export function expectedForeignKeys(
  tableName: string,
  irFields: Record<string, IrField>,
  irs: readonly IrModel[],
): DbForeignKey[] {
  const fks: DbForeignKey[] = [];
  for (const [name, f] of Object.entries(irFields)) {
    if (f.sourceModel || !f.ref) continue;
    const target = irs.find((m) => m.name === f.ref);
    if (!target) continue;
    const pkEntry = Object.entries(target.fields).find(([, pf]) =>
      isPrimaryField(pf),
    );
    if (!pkEntry) continue;
    const [pkName] = pkEntry;

    fks.push({
      name: `fk_${tableName}_${f.alias ?? name}`,
      tableName,
      columns: [f.alias ?? name],
      refTable: f.ref.toLowerCase(),
      refColumns: [pkName],
      // Отсутствие действия в модели — это NO ACTION, а не «действия нет»:
      // так ведёт себя Postgres по умолчанию, и миграции не появляются там,
      // где onDelete() не вызван.
      onDelete: f.onDelete ?? 'NO ACTION',
      onUpdate: f.onUpdate ?? 'NO ACTION',
    });
  }
  return fks;
}
