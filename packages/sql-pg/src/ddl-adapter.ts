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

export class PgDdlAdapter {
  constructor(private client: Pool | PoolClient) {}

  async inspectTables(): Promise<DbTable[]> {
    const result = await this.client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    return result.rows.map((r) => ({ name: r.table_name }));
  }

  async inspectColumns(tableName: string): Promise<DbColumn[]> {
    const result = await this.client.query<any>(
      `SELECT
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
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1
      ) pk ON c.column_name = pk.column_name
      LEFT JOIN (
        SELECT ku.column_name, true AS is_unique
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = $1
      ) uc ON c.column_name = uc.column_name
      WHERE c.table_schema = 'public' AND c.table_name = $1
      ORDER BY c.ordinal_position`,
      [tableName],
    );

    return result.rows.map((r: any) => ({
      name: r.column_name,
      tableName,
      dataType: r.data_type,
      isNullable: r.is_nullable === 'YES',
      defaultValue: r.column_default,
      isPrimary: r.is_primary,
      isUnique: r.is_unique,
      autoIncrement:
        r.data_type === 'integer' && r.column_default?.includes('nextval'),
    }));
  }

  async inspectIndexes(tableName: string): Promise<DbIndex[]> {
    const result = await this.client.query<any>(
      `SELECT ic.relname AS index_name, a.attname AS column_name, i.indisunique AS is_unique
      FROM pg_index i
      JOIN pg_class ic ON i.indexrelid = ic.oid
      JOIN pg_class tc ON i.indrelid = tc.oid
      JOIN pg_namespace n ON tc.relnamespace = n.oid
      JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ANY(i.indkey)
      WHERE n.nspname = 'public' AND tc.relname = $1 AND NOT i.indisprimary
      ORDER BY ic.relname, a.attnum`,
      [tableName],
    );

    const map = new Map<string, { columns: string[]; isUnique: boolean }>();
    for (const r of result.rows) {
      if (!map.has(r.index_name)) {
        map.set(r.index_name, { columns: [], isUnique: r.is_unique });
      }
      map.get(r.index_name)!.columns.push(r.column_name);
    }
    return [...map.entries()].map(([name, data]) => ({
      name,
      tableName,
      columns: data.columns,
      isUnique: data.isUnique,
    }));
  }

  async inspectForeignKeys(tableName: string): Promise<DbForeignKey[]> {
    const result = await this.client.query<any>(
      `SELECT
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
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1
      ORDER BY tc.constraint_name, kcu.ordinal_position`,
      [tableName],
    );

    const map = new Map<
      string,
      {
        columns: string[];
        refTable: string;
        refColumns: string[];
        onDelete: DbForeignKey['onDelete'];
        onUpdate: DbForeignKey['onUpdate'];
      }
    >();
    for (const r of result.rows) {
      if (!map.has(r.fk_name)) {
        map.set(r.fk_name, {
          columns: [],
          refTable: r.ref_table,
          refColumns: [],
          onDelete: r.on_delete,
          onUpdate: r.on_update,
        });
      }
      map.get(r.fk_name)!.columns.push(r.column_name);
      map.get(r.fk_name)!.refColumns.push(r.ref_column);
    }
    return [...map.entries()].map(([name, data]) => ({
      name,
      tableName,
      columns: data.columns,
      refTable: data.refTable,
      refColumns: data.refColumns,
      onDelete: data.onDelete,
      onUpdate: data.onUpdate,
    }));
  }

  async createTable(tableName: string, columns: DbColumn[]): Promise<void> {
    if (columns.length === 0) return;
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
    const type = col.dataType;
    const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
    const def = col.defaultValue !== null ? `DEFAULT ${col.defaultValue}` : '';
    await this.client.query(
      `ALTER TABLE "${table}" ADD COLUMN "${col.name}" ${type} ${nullable} ${def}`.trim(),
    );
  }

  async dropColumn(table: string, colName: string): Promise<void> {
    await this.client.query(
      `ALTER TABLE "${table}" DROP COLUMN "${colName}" CASCADE`,
    );
  }

  async alterType(
    table: string,
    colName: string,
    newType: string,
  ): Promise<void> {
    await this.client.query(
      `ALTER TABLE "${table}" ALTER COLUMN "${colName}" TYPE ${newType} USING "${colName}"::${newType}`,
    );
  }

  async alterNullable(
    table: string,
    colName: string,
    nullable: boolean,
  ): Promise<void> {
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
    if (defaultValue === null) {
      await this.client.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${colName}" DROP DEFAULT`,
      );
    } else {
      await this.client.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${colName}" SET DEFAULT ${defaultValue}`,
      );
    }
  }

  async addIndex(idx: DbIndex): Promise<void> {
    const cols = idx.columns.map((c) => `"${c}"`).join(', ');
    const unique = idx.isUnique ? 'UNIQUE' : '';
    await this.client.query(
      `CREATE ${unique} INDEX "${idx.name}" ON "${idx.tableName}" (${cols})`,
    );
  }

  async dropIndex(indexName: string, tableName: string): Promise<void> {
    await this.client.query(`DROP INDEX IF EXISTS "${indexName}"`);
  }

  async addForeignKey(fk: DbForeignKey): Promise<void> {
    const cols = fk.columns.map((c) => `"${c}"`).join(', ');
    const refCols = fk.refColumns.map((c) => `"${c}"`).join(', ');
    await this.client.query(
      `ALTER TABLE "${fk.tableName}" ADD CONSTRAINT "${fk.name}"
       FOREIGN KEY (${cols}) REFERENCES "${fk.refTable}" (${refCols})
       ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`,
    );
  }

  async dropForeignKey(fkName: string, tableName: string): Promise<void> {
    await this.client.query(
      `ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${fkName}"`,
    );
  }

  async dropTable(tableName: string): Promise<void> {
    await this.client.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
  }

  async raw(sql: string, params?: unknown[]): Promise<any[]> {
    const result = await this.client.query(sql, params);
    return result.rows;
  }
}
