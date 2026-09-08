import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDdlAdapter } from '../src/ddl-adapter';
import type { DbColumn } from '@karkardmitry/kadmium-sql-types';

function makeMockClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('PgDdlAdapter', () => {
  let client: ReturnType<typeof makeMockClient>;
  let ddl: PgDdlAdapter;

  beforeEach(() => {
    client = makeMockClient();
    ddl = new PgDdlAdapter(client);
  });

  describe('inspectTables', () => {
    it('returns empty array when no tables', async () => {
      client.query.mockResolvedValue({ rows: [] });
      expect(await ddl.inspectTables()).toEqual([]);
    });

    it('maps table_name to DbTable', async () => {
      client.query.mockResolvedValue({
        rows: [{ table_name: 'users' }, { table_name: 'posts' }],
      });
      const result = await ddl.inspectTables();
      expect(result).toEqual([{ name: 'users' }, { name: 'posts' }]);
    });
  });

  describe('inspectColumns', () => {
    it('maps column rows to DbColumn', async () => {
      client.query.mockResolvedValue({
        rows: [
          {
            column_name: 'id',
            data_type: 'integer',
            is_nullable: 'NO',
            column_default: null,
            character_maximum_length: null,
            is_primary: true,
            is_unique: true,
          },
        ],
      });
      const result = await ddl.inspectColumns('users');
      expect(result[0]).toEqual({
        name: 'id',
        tableName: 'users',
        dataType: 'integer',
        isNullable: false,
        defaultValue: null,
        isPrimary: true,
        isUnique: true,
        autoIncrement: undefined,
      });
    });

    it('detects autoIncrement via nextval', async () => {
      client.query.mockResolvedValue({
        rows: [
          {
            column_name: 'id',
            data_type: 'integer',
            is_nullable: 'NO',
            column_default: "nextval('users_id_seq'::regclass)",
            character_maximum_length: null,
            is_primary: true,
            is_unique: true,
          },
        ],
      });
      const result = await ddl.inspectColumns('users');
      expect(result[0].autoIncrement).toBe(true);
    });

    it('autoIncrement false when data_type is not integer', async () => {
      client.query.mockResolvedValue({
        rows: [
          {
            column_name: 'id',
            data_type: 'bigint',
            is_nullable: 'NO',
            column_default: "nextval('users_id_seq'::regclass)",
            character_maximum_length: null,
            is_primary: true,
            is_unique: true,
          },
        ],
      });
      const result = await ddl.inspectColumns('users');
      expect(result[0].autoIncrement).toBe(false);
    });
  });

  describe('inspectIndexes', () => {
    it('returns empty when no indexes', async () => {
      client.query.mockResolvedValue({ rows: [] });
      expect(await ddl.inspectIndexes('users')).toEqual([]);
    });

    it('groups multi-column index', async () => {
      client.query.mockResolvedValue({
        rows: [
          { index_name: 'idx_name', column_name: 'name', is_unique: false },
          { index_name: 'idx_name', column_name: 'email', is_unique: false },
        ],
      });
      const result = await ddl.inspectIndexes('users');
      expect(result).toEqual([
        {
          name: 'idx_name',
          tableName: 'users',
          columns: ['name', 'email'],
          isUnique: false,
        },
      ]);
    });
  });

  describe('inspectForeignKeys', () => {
    it('returns empty when no FKs', async () => {
      client.query.mockResolvedValue({ rows: [] });
      expect(await ddl.inspectForeignKeys('posts')).toEqual([]);
    });

    it('groups composite FK', async () => {
      client.query.mockResolvedValue({
        rows: [
          {
            fk_name: 'fk复合',
            column_name: 'a',
            ref_table: 't1',
            ref_column: 'x',
            on_delete: 'CASCADE',
            on_update: 'NO ACTION',
          },
          {
            fk_name: 'fk复合',
            column_name: 'b',
            ref_table: 't1',
            ref_column: 'y',
            on_delete: 'CASCADE',
            on_update: 'NO ACTION',
          },
        ],
      });
      const result = await ddl.inspectForeignKeys('posts');
      expect(result[0].columns).toEqual(['a', 'b']);
      expect(result[0].refColumns).toEqual(['x', 'y']);
    });
  });

  describe('createTable', () => {
    it('returns immediately for empty columns', async () => {
      await ddl.createTable('users', []);
      expect(client.query).not.toHaveBeenCalled();
    });

    it('creates basic table', async () => {
      const cols: DbColumn[] = [
        {
          name: 'name',
          tableName: 'users',
          dataType: 'text',
          isNullable: false,
          defaultValue: null,
          isPrimary: false,
          isUnique: false,
        },
      ];
      await ddl.createTable('users', cols);
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('CREATE TABLE "users"');
      expect(sql).toContain('"name" text NOT NULL');
    });

    it('autoIncrement integer → serial', async () => {
      const cols: DbColumn[] = [
        {
          name: 'id',
          tableName: 'users',
          dataType: 'integer',
          isNullable: false,
          defaultValue: null,
          isPrimary: true,
          isUnique: true,
          autoIncrement: true,
        },
      ];
      await ddl.createTable('users', cols);
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('serial');
      expect(sql).not.toContain('DEFAULT');
    });

    it('autoIncrement bigint → bigserial', async () => {
      const cols: DbColumn[] = [
        {
          name: 'id',
          tableName: 'users',
          dataType: 'bigint',
          isNullable: false,
          defaultValue: null,
          isPrimary: true,
          isUnique: true,
          autoIncrement: true,
        },
      ];
      await ddl.createTable('users', cols);
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('bigserial');
    });

    it('unique column → UNIQUE', async () => {
      const cols: DbColumn[] = [
        {
          name: 'email',
          tableName: 'users',
          dataType: 'text',
          isNullable: false,
          defaultValue: null,
          isPrimary: false,
          isUnique: true,
        },
      ];
      await ddl.createTable('users', cols);
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('UNIQUE');
    });

    it('primary key → PRIMARY KEY, no UNIQUE', async () => {
      const cols: DbColumn[] = [
        {
          name: 'id',
          tableName: 'users',
          dataType: 'integer',
          isNullable: false,
          defaultValue: null,
          isPrimary: true,
          isUnique: true,
        },
      ];
      await ddl.createTable('users', cols);
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('PRIMARY KEY');
      expect(sql).not.toContain('UNIQUE');
    });

    it('column with defaultValue → DEFAULT clause', async () => {
      const cols: DbColumn[] = [
        {
          name: 'active',
          tableName: 'users',
          dataType: 'boolean',
          isNullable: false,
          defaultValue: 'true',
          isPrimary: false,
          isUnique: false,
        },
      ];
      await ddl.createTable('users', cols);
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('DEFAULT true');
    });
  });

  describe('addColumn', () => {
    it('with defaultValue → DEFAULT clause', async () => {
      await ddl.addColumn('users', {
        name: 'score',
        tableName: 'users',
        dataType: 'integer',
        isNullable: false,
        defaultValue: '0',
        isPrimary: false,
        isUnique: false,
      });
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('DEFAULT 0');
    });

    it('null defaultValue → no DEFAULT', async () => {
      await ddl.addColumn('users', {
        name: 'score',
        tableName: 'users',
        dataType: 'integer',
        isNullable: false,
        defaultValue: null,
        isPrimary: false,
        isUnique: false,
      });
      const sql = client.query.mock.calls[0][0];
      expect(sql).not.toContain('DEFAULT');
    });
  });

  describe('alterType', () => {
    it('generates correct SQL with USING cast', async () => {
      await ddl.alterType('users', 'age', 'bigint');
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('ALTER COLUMN "age" TYPE bigint');
      expect(sql).toContain('USING "age"::bigint');
    });
  });

  describe('alterNullable', () => {
    it('nullable=true → DROP NOT NULL', async () => {
      await ddl.alterNullable('users', 'name', true);
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('DROP NOT NULL');
    });

    it('nullable=false → SET NOT NULL', async () => {
      await ddl.alterNullable('users', 'name', false);
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('SET NOT NULL');
    });
  });

  describe('alterDefault', () => {
    it('defaultValue set → SET DEFAULT', async () => {
      await ddl.alterDefault('users', 'name', "'hello'");
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain("SET DEFAULT 'hello'");
    });

    it('defaultValue null → DROP DEFAULT', async () => {
      await ddl.alterDefault('users', 'name', null);
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('DROP DEFAULT');
    });
  });

  describe('addIndex', () => {
    it('non-unique → CREATE INDEX', async () => {
      await ddl.addIndex({
        name: 'idx_name',
        tableName: 'users',
        columns: ['name'],
        isUnique: false,
      });
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('CREATE  INDEX');
      expect(sql).toContain('"idx_name"');
    });

    it('unique → CREATE UNIQUE INDEX', async () => {
      await ddl.addIndex({
        name: 'idx_email',
        tableName: 'users',
        columns: ['email'],
        isUnique: true,
      });
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('CREATE UNIQUE INDEX');
    });
  });

  describe('addForeignKey', () => {
    it('generates correct SQL', async () => {
      await ddl.addForeignKey({
        name: 'fk_author',
        tableName: 'posts',
        columns: ['authorId'],
        refTable: 'users',
        refColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      });
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('FOREIGN KEY ("authorId")');
      expect(sql).toContain('REFERENCES "users" ("id")');
      expect(sql).toContain('ON DELETE CASCADE');
    });
  });

  describe('drop methods', () => {
    it('dropColumn', async () => {
      await ddl.dropColumn('users', 'name');
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('DROP COLUMN "name" CASCADE');
    });

    it('dropIndex', async () => {
      await ddl.dropIndex('idx_name');
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('DROP INDEX IF EXISTS "idx_name"');
    });

    it('dropForeignKey', async () => {
      await ddl.dropForeignKey('fk_author', 'posts');
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('DROP CONSTRAINT IF EXISTS "fk_author"');
    });

    it('dropTable', async () => {
      await ddl.dropTable('users');
      const sql = client.query.mock.calls[0][0];
      expect(sql).toContain('DROP TABLE IF EXISTS "users" CASCADE');
    });
  });

  describe('raw', () => {
    it('passes through to client.query', async () => {
      client.query.mockResolvedValue({ rows: [{ x: 1 }] });
      const result = await ddl.raw('SELECT 1');
      expect(result).toEqual([{ x: 1 }]);
      expect(client.query).toHaveBeenCalledWith('SELECT 1', undefined);
    });

    it('passes params', async () => {
      client.query.mockResolvedValue({ rows: [] });
      await ddl.raw('SELECT $1', ['hello']);
      expect(client.query).toHaveBeenCalledWith('SELECT $1', ['hello']);
    });
  });

  describe('DDL validation (S2)', () => {
    it('createTable rejects malicious table name before query', async () => {
      await expect(
        ddl.createTable('users; DROP TABLE users; --', []),
      ).rejects.toThrow();
      expect(client.query).not.toHaveBeenCalled();
    });

    it('createTable rejects malicious column name', async () => {
      const cols: DbColumn[] = [
        {
          name: 'name" TEXT; --',
          tableName: 'users',
          dataType: 'text',
          isNullable: false,
          defaultValue: null,
          isPrimary: false,
          isUnique: false,
        },
      ];
      await expect(ddl.createTable('users', cols)).rejects.toThrow();
      expect(client.query).not.toHaveBeenCalled();
    });

    it('createTable rejects sql injection in dataType', async () => {
      const cols: DbColumn[] = [
        {
          name: 'name',
          tableName: 'users',
          dataType: 'text; DROP TABLE users; --',
          isNullable: false,
          defaultValue: null,
          isPrimary: false,
          isUnique: false,
        },
      ];
      await expect(ddl.createTable('users', cols)).rejects.toThrow();
      expect(client.query).not.toHaveBeenCalled();
    });

    it('createTable rejects sql injection in defaultValue', async () => {
      const cols: DbColumn[] = [
        {
          name: 'active',
          tableName: 'users',
          dataType: 'boolean',
          isNullable: false,
          defaultValue: 'true; DROP TABLE users; --',
          isPrimary: false,
          isUnique: false,
        },
      ];
      await expect(ddl.createTable('users', cols)).rejects.toThrow();
      expect(client.query).not.toHaveBeenCalled();
    });

    it('alterType rejects malicious newType', async () => {
      await expect(
        ddl.alterType('users', 'age', 'bigint; DROP TABLE users; --'),
      ).rejects.toThrow();
      expect(client.query).not.toHaveBeenCalled();
    });

    it('alterDefault rejects malicious defaultValue', async () => {
      await expect(
        ddl.alterDefault('users', 'name', "'x'; DROP TABLE users; --"),
      ).rejects.toThrow();
      expect(client.query).not.toHaveBeenCalled();
    });

    it('addForeignKey rejects malicious ON UPDATE', async () => {
      await expect(
        ddl.addForeignKey({
          name: 'fk_author',
          tableName: 'posts',
          columns: ['authorId'],
          refTable: 'users',
          refColumns: ['id'],
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION; DROP TABLE users; --',
        }),
      ).rejects.toThrow();
      expect(client.query).not.toHaveBeenCalled();
    });
  });
});
