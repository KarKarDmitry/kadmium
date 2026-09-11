/**
 * Защита DDL от SQL-инъекций.
 *
 * Postgres не поддерживает bind-параметры в DDL (`SET DEFAULT $1`, `TYPE $1`
 * недопустимы), поэтому единственная защита от инъекции через dev-конфиг —
 * строгая валидация на этапе сборки SQL: идентификаторы по allowlist-паттерну,
 * выражения по allowlist-символам + запрет statement-breaker'ов и комментариев.
 */

import type { DiffOp } from './diff/types';

/** Unquoted SQL-идентификатор (Postgres): буква/подчёркивание, далее буквы/цифры/_. */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_IDENTIFIER_LENGTH = 63;

/** Допустимые символы в DDL-выражении (DEFAULT/TYPE/USING cast). */
const ALLOWED_CHARS_RE = /^[A-Za-z0-9_'".:(),=+*<>[\]{} -]*$/;
const COMMENT_RE = /--|\/\*|\*\//;

/** Referential actions разрешены only из фиксированного набора. */
const REFERENTIAL_ACTIONS: ReadonlySet<string> = new Set([
  'NO ACTION',
  'CASCADE',
  'SET NULL',
  'RESTRICT',
  'SET DEFAULT',
]);

export function assertSqlIdentifier(name: string, what: string): void {
  if (
    name.length === 0 ||
    name.length > MAX_IDENTIFIER_LENGTH ||
    !IDENTIFIER_RE.test(name)
  ) {
    throw new Error(
      `Invalid SQL identifier for ${what}: ${JSON.stringify(name)}`,
    );
  }
}

export function assertSqlExpression(expr: string, what: string): void {
  if (expr.length === 0) {
    throw new Error(`Invalid SQL expression for ${what}: empty`);
  }
  if (
    expr.includes(';') ||
    COMMENT_RE.test(expr) ||
    !ALLOWED_CHARS_RE.test(expr)
  ) {
    throw new Error(
      `Invalid SQL expression for ${what}: ${JSON.stringify(expr)}`,
    );
  }

  let depth = 0;
  let quote: "'" | '"' | '`' | null = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === quote) {
        // `` (escaped quote) — не закрывает строку
        if (expr[i + 1] === quote) i++;
        else quote = null;
      }
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth < 0) {
        throw new Error(
          `Invalid SQL expression for ${what}: unbalanced parenthesis`,
        );
      }
    }
  }
  if (depth !== 0 || quote !== null) {
    throw new Error(`Invalid SQL expression for ${what}: unbalanced syntax`);
  }
}

export function assertReferentialAction(action: string, what: string): void {
  if (!REFERENTIAL_ACTIONS.has(action)) {
    throw new Error(
      `Invalid referential action for ${what}: ${JSON.stringify(action)}`,
    );
  }
}

export function assertSqlIdentifierList(
  names: readonly string[],
  what: string,
): void {
  for (const n of names) assertSqlIdentifier(n, what);
}

/** Проверить все интерполируемые части одного DiffOp (путь превью renderSql). */
export function assertDiffOpSqlSafe(op: DiffOp): void {
  switch (op.type) {
    case 'create-table':
      assertSqlIdentifier(op.table, 'table name');
      for (const c of op.columns) {
        assertSqlIdentifier(c.name, 'column name');
        assertSqlExpression(c.dataType, `type of ${c.name}`);
        if (c.defaultValue !== null)
          assertSqlExpression(c.defaultValue, `default of ${c.name}`);
      }
      break;
    case 'drop-table':
      assertSqlIdentifier(op.table, 'table name');
      break;
    case 'add-column':
      assertSqlIdentifier(op.table, 'table name');
      assertSqlIdentifier(op.column.name, 'column name');
      assertSqlExpression(op.column.dataType, `type of ${op.column.name}`);
      if (op.column.defaultValue !== null)
        assertSqlExpression(
          op.column.defaultValue,
          `default of ${op.column.name}`,
        );
      break;
    case 'drop-column':
      assertSqlIdentifier(op.table, 'table name');
      assertSqlIdentifier(op.columnName, 'column name');
      break;
    case 'alter-type':
      assertSqlIdentifier(op.table, 'table name');
      assertSqlIdentifier(op.columnName, 'column name');
      assertSqlExpression(op.newType, `type of ${op.columnName}`);
      break;
    case 'alter-nullable':
      assertSqlIdentifier(op.table, 'table name');
      assertSqlIdentifier(op.columnName, 'column name');
      break;
    case 'add-index':
      assertSqlIdentifier(op.index.name, 'index name');
      assertSqlIdentifier(op.index.tableName, 'table name');
      assertSqlIdentifierList(op.index.columns, 'index columns');
      break;
    case 'drop-index':
      assertSqlIdentifier(op.indexName, 'index name');
      break;
    case 'add-foreign-key':
      assertSqlIdentifier(op.fk.name, 'foreign key name');
      assertSqlIdentifier(op.fk.tableName, 'table name');
      assertSqlIdentifierList(op.fk.columns, 'foreign key columns');
      assertSqlIdentifier(op.fk.refTable, 'referenced table name');
      assertSqlIdentifierList(op.fk.refColumns, 'referenced columns');
      assertReferentialAction(op.fk.onDelete, 'ON DELETE');
      assertReferentialAction(op.fk.onUpdate, 'ON UPDATE');
      break;
    case 'drop-foreign-key':
      assertSqlIdentifier(op.tableName, 'table name');
      assertSqlIdentifier(op.fkName, 'foreign key name');
      break;
  }
}
