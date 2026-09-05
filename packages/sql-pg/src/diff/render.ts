/**
 * renderSql — generate SQL preview string from DiffResult.
 */

import type { DiffOp, DiffResult } from './types';

function opToSql(op: DiffOp): string {
  switch (op.type) {
    case 'create-table': {
      const colDefs = op.columns
        .map((c) => {
          let type = c.dataType;
          if (c.autoIncrement) {
            if (type === 'integer') type = 'serial';
            else if (type === 'bigint') type = 'bigserial';
          }
          const nullable = c.isNullable ? 'NULL' : 'NOT NULL';
          const pk = c.isPrimary ? 'PRIMARY KEY' : '';
          const uniq = c.isUnique && !c.isPrimary ? 'UNIQUE' : '';
          return `  "${c.name}" ${type} ${nullable} ${pk} ${uniq}`.trim();
        })
        .join(',\n');
      return `CREATE TABLE "${op.table}" (\n${colDefs}\n);`;
    }
    case 'drop-table':
      return `DROP TABLE "${op.table}" CASCADE;`;
    case 'add-column': {
      const c = op.column;
      const nullable = c.isNullable ? 'NULL' : 'NOT NULL';
      return `ALTER TABLE "${op.table}" ADD COLUMN "${c.name}" ${c.dataType} ${nullable};`;
    }
    case 'drop-column':
      return `ALTER TABLE "${op.table}" DROP COLUMN "${op.columnName}" CASCADE;`;
    case 'alter-type':
      return `ALTER TABLE "${op.table}" ALTER COLUMN "${op.columnName}" TYPE ${op.newType} USING "${op.columnName}"::${op.newType};`;
    case 'alter-nullable':
      return op.newNullable
        ? `ALTER TABLE "${op.table}" ALTER COLUMN "${op.columnName}" DROP NOT NULL;`
        : `ALTER TABLE "${op.table}" ALTER COLUMN "${op.columnName}" SET NOT NULL;`;
    case 'add-index': {
      const cols = op.index.columns.map((c) => `"${c}"`).join(', ');
      const unique = op.index.isUnique ? 'UNIQUE ' : '';
      return `CREATE ${unique}INDEX "${op.index.name}" ON "${op.index.tableName}" (${cols});`;
    }
    case 'drop-index':
      return `DROP INDEX IF EXISTS "${op.indexName}";`;
    case 'add-foreign-key': {
      const cols = op.fk.columns.map((c) => `"${c}"`).join(', ');
      const refCols = op.fk.refColumns.map((c) => `"${c}"`).join(', ');
      return `ALTER TABLE "${op.fk.tableName}" ADD CONSTRAINT "${op.fk.name}" FOREIGN KEY (${cols}) REFERENCES "${op.fk.refTable}" (${refCols}) ON DELETE ${op.fk.onDelete} ON UPDATE ${op.fk.onUpdate};`;
    }
    case 'drop-foreign-key':
      return `ALTER TABLE "${op.tableName}" DROP CONSTRAINT IF EXISTS "${op.fkName}";`;
  }
}

export function renderSql(diff: DiffResult): string {
  if (!diff.hasChanges) return '-- No changes needed.\n';
  const lines = diff.operations.map((op) => opToSql(op));
  return `BEGIN;\n\n${lines.join('\n\n')}\n\nCOMMIT;\n`;
}
