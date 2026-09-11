/**
 * PostgreSQL DDL adapter.
 * Копия из старого проекта, адаптированная под наши типы.
 */
import type {
  DbTable,
  DbColumn,
  DbIndex,
  DbForeignKey,
} from '@karkardmitry/kadmium-sql-types';
import { Pool, PoolClient } from 'pg';
import {
  assertSqlIdentifier,
  assertSqlIdentifierList,
  assertSqlExpression,
  assertReferentialAction,
} from './ddl-validate';

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  is_primary: boolean;
  is_unique: boolean;
}

interface IndexRow {
  table_name: string;
  index_name: string;
  column_name: string;
  is_unique: boolean;
}

interface FkRow {
  table_name: string;
  fk_name: string;
  column_name: string;
  ref_table: string;
  ref_column: string;
  on_delete: DbForeignKey['onDelete'];
  on_update: DbForeignKey['onUpdate'];
}

export class PgDdlAdapter {
  constructor(private client: Pool | PoolClient) {}

  async inspectTables(): Promise<DbTable[]> {
    const result = await this.client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    return result.rows.map((r) => ({ name: r.table_name }));
  }

  async inspectAllColumns(tableNames: string[]): Promise<DbColumn[]> {
    const result = await this.client.query<ColumnRow>(
      `SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        COALESCE(pk.is_primary, false) AS is_primary,
        COALESCE(uc.is_unique, false) AS is_unique
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.column_name, true AS is_primary
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = ANY($1::text[])
      ) pk ON c.column_name = pk.column_name
      LEFT JOIN (
        SELECT ku.column_name, true AS is_unique
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = ANY($1::text[])
      ) uc ON c.column_name = uc.column_name
      WHERE c.table_schema = 'public' AND c.table_name = ANY($1::text[])
      ORDER BY c.table_name, c.ordinal_position`,
      [tableNames],
    );

    return result.rows.map((r) => ({
      name: r.column_name,
      tableName: r.table_name,
      dataType: r.data_type,
      isNullable: r.is_nullable === 'YES',
      defaultValue: r.column_default,
      isPrimary: r.is_primary,
      isUnique: r.is_unique,
      autoIncrement:
        r.data_type === 'integer' && r.column_default?.includes('nextval'),
    }));
  }

  async inspectAllIndexes(tableNames: string[]): Promise<DbIndex[]> {
    const result = await this.client.query<IndexRow>(
      `SELECT tc.relname AS table_name, ic.relname AS index_name, a.attname AS column_name, i.indisunique AS is_unique
      FROM pg_index i
      JOIN pg_class ic ON i.indexrelid = ic.oid
      JOIN pg_class tc ON i.indrelid = tc.oid
      JOIN pg_namespace n ON tc.relnamespace = n.oid
      JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ANY(i.indkey)
      WHERE n.nspname = 'public' AND tc.relname = ANY($1::text[]) AND NOT i.indisprimary
      ORDER BY tc.relname, ic.relname, a.attnum`,
      [tableNames],
    );

    const map = new Map<
      string,
      { tableName: string; columns: string[]; isUnique: boolean }
    >();
    for (const r of result.rows) {
      let entry = map.get(r.index_name);
      if (!entry) {
        entry = { tableName: r.table_name, columns: [], isUnique: r.is_unique };
        map.set(r.index_name, entry);
      }
      entry.columns.push(r.column_name);
    }
    return [...map.entries()].map(([name, data]) => ({
      name,
      tableName: data.tableName,
      columns: data.columns,
      isUnique: data.isUnique,
    }));
  }

  async inspectAllForeignKeys(tableNames: string[]): Promise<DbForeignKey[]> {
    const result = await this.client.query<FkRow>(
      `SELECT
        tc.table_name,
        tc.constraint_name AS fk_name,
        kcu.column_name,
        ccu.table_name AS ref_table,
        ccu.column_name AS ref_column,
        rc.delete_rule AS on_delete,
        rc.update_rule AS on_update
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ANY($1::text[])
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
      [tableNames],
    );

    const map = new Map<
      string,
      {
        fkName: string;
        tableName: string;
        columns: string[];
        refTable: string;
        refColumns: string[];
        onDelete: DbForeignKey['onDelete'];
        onUpdate: DbForeignKey['onUpdate'];
      }
    >();
    for (const r of result.rows) {
      const key = `${r.table_name}\u0000${r.fk_name}`;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          fkName: r.fk_name,
          tableName: r.table_name,
          columns: [],
          refTable: r.ref_table,
          refColumns: [],
          onDelete: r.on_delete,
          onUpdate: r.on_update,
        };
        map.set(key, entry);
      }
      entry.columns.push(r.column_name);
      entry.refColumns.push(r.ref_column);
    }
    return [...map.values()].map((data) => ({
      name: data.fkName,
      tableName: data.tableName,
      columns: data.columns,
      refTable: data.refTable,
      refColumns: data.refColumns,
      onDelete: data.onDelete,
      onUpdate: data.onUpdate,
    }));
  }

  async createTable(tableName: string, columns: DbColumn[]): Promise<void> {
    assertSqlIdentifier(tableName, 'table name');
    if (columns.length === 0) return;
    for (const col of columns) {
      assertSqlIdentifier(col.name, 'column name');
      assertSqlExpression(col.dataType, `type of ${col.name}`);
      if (col.defaultValue !== null)
        assertSqlExpression(col.defaultValue, `default of ${col.name}`);
    }
    const colDefs = columns
      .map((col) => {
        let type = col.dataType;
        if (col.autoIncrement) {
          if (type === 'integer') type = 'serial';
          else if (type === 'bigint') type = 'bigserial';
        }
        const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
        const pk = col.isPrimary ? 'PRIMARY KEY' : '';
        const uniq = col.isUnique && !col.isPrimary ? 'UNIQUE' : '';
        const def = col.autoIncrement
          ? ''
          : col.defaultValue !== null
            ? `DEFAULT ${col.defaultValue}`
            : '';
        return `"${col.name}" ${type} ${nullable} ${pk} ${uniq} ${def}`.trim();
      })
      .join(',\n  ');
    await this.client.query(`CREATE TABLE "${tableName}" (\n  ${colDefs}\n)`);
  }

  async addColumn(table: string, col: DbColumn): Promise<void> {
    assertSqlIdentifier(table, 'table name');
    assertSqlIdentifier(col.name, 'column name');
    assertSqlExpression(col.dataType, `type of ${col.name}`);
    if (col.defaultValue !== null)
      assertSqlExpression(col.defaultValue, `default of ${col.name}`);
    const type = col.dataType;
    const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
    const def = col.defaultValue !== null ? `DEFAULT ${col.defaultValue}` : '';
    await this.client.query(
      `ALTER TABLE "${table}" ADD COLUMN "${col.name}" ${type} ${nullable} ${def}`.trim(),
    );
  }

  async dropColumn(table: string, colName: string): Promise<void> {
    assertSqlIdentifier(table, 'table name');
    assertSqlIdentifier(colName, 'column name');
    await this.client.query(
      `ALTER TABLE "${table}" DROP COLUMN "${colName}" CASCADE`,
    );
  }

  async alterType(
    table: string,
    colName: string,
    newType: string,
  ): Promise<void> {
    assertSqlIdentifier(table, 'table name');
    assertSqlIdentifier(colName, 'column name');
    assertSqlExpression(newType, `type of ${colName}`);
    await this.client.query(
      `ALTER TABLE "${table}" ALTER COLUMN "${colName}" TYPE ${newType} USING "${colName}"::${newType}`,
    );
  }

  async alterNullable(
    table: string,
    colName: string,
    nullable: boolean,
  ): Promise<void> {
    assertSqlIdentifier(table, 'table name');
    assertSqlIdentifier(colName, 'column name');
    const action = nullable ? 'DROP NOT NULL' : 'SET NOT NULL';
    await this.client.query(
      `ALTER TABLE "${table}" ALTER COLUMN "${colName}" ${action}`,
    );
  }

  async alterDefault(
    table: string,
    colName: string,
    defaultValue: string | null,
  ): Promise<void> {
    assertSqlIdentifier(table, 'table name');
    assertSqlIdentifier(colName, 'column name');
    if (defaultValue === null) {
      await this.client.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${colName}" DROP DEFAULT`,
      );
    } else {
      assertSqlExpression(defaultValue, `default of ${colName}`);
      await this.client.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${colName}" SET DEFAULT ${defaultValue}`,
      );
    }
  }

  async addIndex(idx: DbIndex): Promise<void> {
    assertSqlIdentifier(idx.name, 'index name');
    assertSqlIdentifier(idx.tableName, 'table name');
    assertSqlIdentifierList(idx.columns, 'index columns');
    const cols = idx.columns.map((c) => `"${c}"`).join(', ');
    const unique = idx.isUnique ? 'UNIQUE' : '';
    await this.client.query(
      `CREATE ${unique} INDEX "${idx.name}" ON "${idx.tableName}" (${cols})`,
    );
  }

  async dropIndex(indexName: string): Promise<void> {
    assertSqlIdentifier(indexName, 'index name');
    await this.client.query(`DROP INDEX IF EXISTS "${indexName}"`);
  }

  async addForeignKey(fk: DbForeignKey): Promise<void> {
    assertSqlIdentifier(fk.name, 'foreign key name');
    assertSqlIdentifier(fk.tableName, 'table name');
    assertSqlIdentifierList(fk.columns, 'foreign key columns');
    assertSqlIdentifier(fk.refTable, 'referenced table name');
    assertSqlIdentifierList(fk.refColumns, 'referenced columns');
    assertReferentialAction(fk.onDelete, 'ON DELETE');
    assertReferentialAction(fk.onUpdate, 'ON UPDATE');
    const cols = fk.columns.map((c) => `"${c}"`).join(', ');
    const refCols = fk.refColumns.map((c) => `"${c}"`).join(', ');
    await this.client.query(
      `ALTER TABLE "${fk.tableName}" ADD CONSTRAINT "${fk.name}"
       FOREIGN KEY (${cols}) REFERENCES "${fk.refTable}" (${refCols})
       ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`,
    );
  }

  async dropForeignKey(fkName: string, tableName: string): Promise<void> {
    assertSqlIdentifier(tableName, 'table name');
    assertSqlIdentifier(fkName, 'foreign key name');
    await this.client.query(
      `ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${fkName}"`,
    );
  }

  async dropTable(tableName: string): Promise<void> {
    assertSqlIdentifier(tableName, 'table name');
    await this.client.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
  }

  async raw(
    sql: string,
    params?: unknown[],
  ): Promise<Record<string, unknown>[]> {
    const result = await this.client.query(sql, params);
    return result.rows;
  }
}
