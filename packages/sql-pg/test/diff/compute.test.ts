import { describe, it, expect } from 'vitest';
import { computeDiff } from '../../src/diff/compute';
import type {
  DbForeignKey,
  DbIndex,
  DbTable,
} from '@karkardmitry/kadmium-sql-types';
import { irs, postColumns, userColumns, MockDdl } from './fixtures';

function syncedDdl(): MockDdl {
  const ddl = new MockDdl();
  const tables: DbTable[] = [{ name: 'users' }, { name: 'posts' }];
  const indexes: Record<string, DbIndex[]> = {
    users: [
      {
        name: 'idx_users_email',
        tableName: 'users',
        columns: ['email'],
        isUnique: true,
      },
    ],
    posts: [
      {
        name: 'idx_posts_author',
        tableName: 'posts',
        columns: ['author'],
        isUnique: false,
      },
    ],
  };
  const fks: Record<string, DbForeignKey[]> = {
    posts: [
      {
        name: 'fk_posts_author',
        tableName: 'posts',
        columns: ['author'],
        refTable: 'user',
        refColumns: ['id'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    ],
  };
  ddl.setSchema(
    tables,
    { users: userColumns, posts: postColumns },
    indexes,
    fks,
  );
  return ddl;
}

describe('computeDiff', () => {
  it('reports no changes when schema matches models', async () => {
    const diff = await computeDiff(irs, syncedDdl());
    expect(diff.hasChanges).toBe(false);
    expect(diff.operations).toEqual([]);
    expect(diff.summary.addedTables).toBe(0);
  });

  it('creates new tables with indexes and foreign keys', async () => {
    const ddl = new MockDdl();
    ddl.setSchema([]);
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary).toMatchObject({
      addedTables: 2,
      addedIndexes: 2,
      addedForeignKeys: 1,
    });

    const types = diff.operations.map((o) => o.type);
    expect(types).toEqual([
      'create-table',
      'add-index',
      'create-table',
      'add-index',
      'add-foreign-key',
    ]);

    const createUsers = diff.operations.find(
      (o) => o.type === 'create-table' && o.table === 'users',
    );
    expect(createUsers?.type === 'create-table').toBe(true);
    if (createUsers?.type === 'create-table') {
      expect(createUsers.columns.map((c) => c.name)).toEqual([
        'id',
        'name',
        'email',
      ]);
      const id = createUsers.columns.find((c) => c.name === 'id');
      expect(id?.isPrimary).toBe(true);
      expect(id?.autoIncrement).toBe(true);
    }

    const addPostAuthor = diff.operations.find(
      (o) => o.type === 'add-foreign-key',
    );
    expect(
      addPostAuthor && addPostAuthor.type === 'add-foreign-key'
        ? addPostAuthor.fk
        : null,
    ).toMatchObject({
      name: 'fk_posts_author',
      tableName: 'posts',
      columns: ['author'],
      refTable: 'user',
      refColumns: ['id'],
    });

    const addPostAuthorIdx = diff.operations.find(
      (o) => o.type === 'add-index' && o.index.tableName === 'posts',
    );
    expect(
      addPostAuthorIdx && addPostAuthorIdx.type === 'add-index'
        ? addPostAuthorIdx.index
        : null,
    ).toEqual({
      name: 'idx_posts_author',
      tableName: 'posts',
      columns: ['author'],
      isUnique: false,
    });
  });

  it('emits add-column for a column missing from an existing table', async () => {
    const ddl = syncedDdl();
    ddl.columns.set(
      'posts',
      postColumns.filter((c) => c.name !== 'title'),
    );
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.addedColumns).toBe(1);
    expect(diff.operations).toEqual([
      {
        type: 'add-column',
        table: 'posts',
        column: expect.objectContaining({ name: 'title' }),
      },
    ]);
  });

  it('emits drop-column for a column not in the model', async () => {
    const ddl = syncedDdl();
    ddl.columns.set('posts', [
      ...postColumns,
      {
        name: 'legacy',
        tableName: 'posts',
        dataType: 'character varying',
        isNullable: true,
        defaultValue: null,
        isPrimary: false,
        isUnique: false,
      },
    ]);
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.droppedColumns).toBe(1);
    expect(
      diff.operations.find(
        (o) => o.type === 'drop-column' && o.columnName === 'legacy',
      ),
    ).toBeDefined();
  });

  it('emits alter-type when pg type differs', async () => {
    const ddl = syncedDdl();
    ddl.columns.set(
      'posts',
      postColumns.map((c) =>
        c.name === 'author' ? { ...c, dataType: 'bigint' } : c,
      ),
    );
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.alteredColumns).toBe(1);
    expect(diff.operations).toContainEqual({
      type: 'alter-type',
      table: 'posts',
      columnName: 'author',
      oldType: 'bigint',
      newType: 'integer',
    });
  });

  it('emits alter-nullable when nullability differs', async () => {
    const ddl = syncedDdl();
    ddl.columns.set(
      'users',
      userColumns.map((c) =>
        c.name === 'name' ? { ...c, isNullable: true } : c,
      ),
    );
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.alteredColumns).toBe(1);
    expect(diff.operations).toContainEqual({
      type: 'alter-nullable',
      table: 'users',
      columnName: 'name',
      oldNullable: true,
      newNullable: false,
    });
  });

  it('emits add-index for a missing unique index', async () => {
    const ddl = syncedDdl();
    ddl.indexes.set('users', []);
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.addedIndexes).toBe(1);
    expect(
      diff.operations.find(
        (o) => o.type === 'add-index' && o.index.name === 'idx_users_email',
      ),
    ).toMatchObject({
      type: 'add-index',
      index: { name: 'idx_users_email', isUnique: true, columns: ['email'] },
    });
  });

  it('emits drop-index for an unexpected non-system index', async () => {
    const ddl = syncedDdl();
    ddl.indexes.set('posts', [
      ...(ddl.indexes.get('posts') ?? []),
      {
        name: 'idx_posts_legacy',
        tableName: 'posts',
        columns: ['legacy'],
        isUnique: false,
      },
    ]);
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.droppedIndexes).toBe(1);
    expect(
      diff.operations.find(
        (o) => o.type === 'drop-index' && o.indexName === 'idx_posts_legacy',
      ),
    ).toMatchObject({
      type: 'drop-index',
      indexName: 'idx_posts_legacy',
      tableName: 'posts',
    });
  });

  it('ignores system auto-created indexes (_pkey, _key)', async () => {
    const ddl = syncedDdl();
    ddl.indexes.set('users', [
      {
        name: 'users_pkey',
        tableName: 'users',
        columns: ['id'],
        isUnique: true,
      },
      {
        name: 'users_email_key',
        tableName: 'users',
        columns: ['email'],
        isUnique: true,
      },
    ]);
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.droppedIndexes).toBe(0);
  });

  it('emits add-foreign-key for a missing FK', async () => {
    const ddl = syncedDdl();
    ddl.foreignKeys.set('posts', []);
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.addedForeignKeys).toBe(1);
    expect(
      diff.operations.find((o) => o.type === 'add-foreign-key'),
    ).toMatchObject({
      type: 'add-foreign-key',
      fk: { name: 'fk_posts_author', refTable: 'user' },
    });
  });

  it('emits drop-foreign-key for an unexpected FK', async () => {
    const ddl = syncedDdl();
    ddl.foreignKeys.set('posts', [
      ...(ddl.foreignKeys.get('posts') ?? []),
      {
        name: 'fk_posts_category',
        tableName: 'posts',
        columns: ['category_id'],
        refTable: 'category',
        refColumns: ['id'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    ]);
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.droppedForeignKeys).toBe(1);
    expect(
      diff.operations.find((o) => o.type === 'drop-foreign-key'),
    ).toMatchObject({
      type: 'drop-foreign-key',
      fkName: 'fk_posts_category',
      tableName: 'posts',
    });
  });

  it('does not auto-drop tables missing from the models', async () => {
    const ddl = syncedDdl();
    ddl.tables.push({ name: 'logs' });
    const diff = await computeDiff(irs, ddl);

    expect(diff.operations.some((o) => o.type === 'drop-table')).toBe(false);
    expect(diff.summary.droppedTables).toBe(0);
  });

  it('uses alias as column and index name', async () => {
    const ir = {
      name: 'Tag',
      collection: 'tags',
      fields: {
        id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
        display_name: {
          type: 'string',
          nullable: false,
          unique: true,
          alias: 'display_name',
        },
      },
    };
    const ddl = new MockDdl();
    ddl.setSchema([]);
    const diff = await computeDiff([ir], ddl);

    const create = diff.operations.find((o) => o.type === 'create-table');
    expect(
      create && create.type === 'create-table'
        ? create.columns.map((c) => c.name)
        : [],
    ).toEqual(['id', 'display_name']);
    const idx = diff.operations.find((o) => o.type === 'add-index');
    expect(idx && idx.type === 'add-index' ? idx.index.name : '').toBe(
      'idx_tags_display_name',
    );
  });

  it('skips sourceModel fields in new tables', async () => {
    const ir = {
      name: 'User',
      collection: 'users',
      fields: {
        id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
        posts: {
          type: 'ref',
          ref: 'Post',
          nullable: false,
          unique: false,
          sourceModel: 'Post',
        },
      },
    };
    const ddl = new MockDdl();
    ddl.setSchema([]);
    const diff = await computeDiff([ir], ddl);

    const create = diff.operations.find((o) => o.type === 'create-table');
    expect(
      create && create.type === 'create-table'
        ? create.columns.map((c) => c.name)
        : [],
    ).toEqual(['id']);
  });

  it('introspects via 4 batched calls regardless of table count', async () => {
    const ddl = syncedDdl();
    await computeDiff(irs, ddl);

    const inspectCalls = ddl.calls.filter((c) =>
      c.method.startsWith('inspect'),
    );
    expect(inspectCalls.map((c) => c.method)).toEqual([
      'inspectTables',
      'inspectAllColumns',
      'inspectAllIndexes',
      'inspectAllForeignKeys',
    ]);
    const expectedTables = ['users', 'posts'];
    for (const call of inspectCalls.slice(1)) {
      expect(call.args[0]).toEqual(expectedTables);
    }
  });
});
