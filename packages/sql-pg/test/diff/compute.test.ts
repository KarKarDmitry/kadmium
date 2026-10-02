import { describe, it, expect } from 'vitest';
import { computeDiff } from '../../src/diff/compute';
import type {
  DbForeignKey,
  DbIndex,
  DbTable,
  ReferentialAction,
} from '@karkardmitry/kadmium-sql-types';
import {
  irs,
  postColumns,
  postFields,
  userColumns,
  userFields,
  MockDdl,
} from './fixtures';
import type { IrField } from '../../src/diff/types';

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

  it('recreates an index when uniqueness is gained on an existing name', async () => {
    // IR хочет уникальный email, в БД индекс с тем же именем есть, но
    // неуникальный. Сверка только по имени дала бы пустой diff, и уникальность
    // не появилась бы никогда.
    const ddl = syncedDdl();
    ddl.indexes.set('users', [
      {
        name: 'idx_users_email',
        tableName: 'users',
        columns: ['email'],
        isUnique: false,
      },
    ]);
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.droppedIndexes).toBe(1);
    expect(diff.summary.addedIndexes).toBe(1);

    const idxOps = diff.operations.filter(
      (o) => o.type === 'drop-index' || o.type === 'add-index',
    );
    // Порядок обязателен: applyDiff выполняет операции как есть, и add-index
    // перед drop-index упёрся бы в уже существующий индекс.
    expect(idxOps.map((o) => o.type)).toEqual(['drop-index', 'add-index']);
    expect(idxOps[0]).toMatchObject({
      type: 'drop-index',
      indexName: 'idx_users_email',
      tableName: 'users',
    });
    expect(idxOps[1]).toMatchObject({
      type: 'add-index',
      index: { name: 'idx_users_email', isUnique: true, columns: ['email'] },
    });
  });

  it('recreates an index when uniqueness is dropped', async () => {
    // Обратный переход: `.unique()` сняли с поля, но имя индекса осталось тем
    // же, поэтому по имени расхождения не видно — а ограничение осталось бы
    // в схеме навсегда.
    const ddl = syncedDdl();
    ddl.indexes.set('posts', [
      {
        name: 'idx_posts_author',
        tableName: 'posts',
        columns: ['author'],
        isUnique: true,
      },
    ]);
    const diff = await computeDiff(irs, ddl);

    expect(diff.summary.droppedIndexes).toBe(1);
    const idxOps = diff.operations.filter(
      (o) => o.type === 'drop-index' || o.type === 'add-index',
    );
    expect(idxOps.map((o) => o.type)).toEqual(['drop-index', 'add-index']);
    expect(idxOps[1]).toMatchObject({
      type: 'add-index',
      index: { name: 'idx_posts_author', isUnique: false },
    });
  });

  it('does not touch an index whose uniqueness already matches', async () => {
    const diff = await computeDiff(irs, syncedDdl());
    expect(
      diff.operations.filter(
        (o) => o.type === 'drop-index' || o.type === 'add-index',
      ),
    ).toEqual([]);
    expect(diff.summary.addedIndexes).toBe(0);
    expect(diff.summary.droppedIndexes).toBe(0);
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

  describe('referential action changes', () => {
    const irsWithAction = (
      onDelete?: ReferentialAction,
      onUpdate?: ReferentialAction,
    ) => [
      { name: 'User', collection: 'users', fields: userFields },
      {
        name: 'Post',
        collection: 'posts',
        fields: {
          ...postFields,
          author: { ...postFields.author, onDelete, onUpdate },
        },
      },
    ];

    const fkIn = (ddl: MockDdl, fk: Partial<DbForeignKey>) => {
      const current = ddl.foreignKeys.get('posts')?.[0];
      return ddl.foreignKeys.set('posts', [
        {
          name: 'fk_posts_author',
          tableName: 'posts',
          columns: ['author'],
          refTable: 'user',
          refColumns: ['id'],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
          ...fk,
        },
        ...(current && current.name !== 'fk_posts_author' ? [current] : []),
      ]);
    };

    it('emits alter-foreign-key when ON DELETE changes', async () => {
      const ddl = syncedDdl();
      const diff = await computeDiff(irsWithAction('CASCADE'), ddl);

      expect(diff.summary.alteredForeignKeys).toBe(1);
      expect(diff.summary.addedForeignKeys).toBe(0);
      expect(diff.summary.droppedForeignKeys).toBe(0);
      expect(
        diff.operations.find((o) => o.type === 'alter-foreign-key'),
      ).toMatchObject({
        type: 'alter-foreign-key',
        fkName: 'fk_posts_author',
        tableName: 'posts',
        oldFk: { onDelete: 'NO ACTION' },
        newFk: { onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
      });
    });

    it('emits alter-foreign-key when ON UPDATE changes', async () => {
      const diff = await computeDiff(
        irsWithAction(undefined, 'RESTRICT'),
        syncedDdl(),
      );
      expect(diff.summary.alteredForeignKeys).toBe(1);
      expect(
        diff.operations.find((o) => o.type === 'alter-foreign-key'),
      ).toMatchObject({
        newFk: { onDelete: 'NO ACTION', onUpdate: 'RESTRICT' },
      });
    });

    it('emits alter-foreign-key when the action is removed from the model', async () => {
      const ddl = syncedDdl();
      fkIn(ddl, { name: 'fk_posts_author', onDelete: 'CASCADE' });
      const diff = await computeDiff(irs, ddl);

      expect(diff.summary.alteredForeignKeys).toBe(1);
      expect(
        diff.operations.find((o) => o.type === 'alter-foreign-key'),
      ).toMatchObject({ newFk: { onDelete: 'NO ACTION' } });
    });

    it('emits alter-foreign-key when the ref target changes', async () => {
      const ddl = syncedDdl();
      // The FK target comes from the referenced model's name, so a rename
      // retargets the constraint rather than dropping and re-adding it.
      const renamed: Array<{
        name: string;
        collection: string;
        fields: Record<string, IrField>;
      }> = [
        { name: 'User', collection: 'users', fields: userFields },
        {
          name: 'Account',
          collection: 'accounts',
          fields: { id: userFields.id },
        },
        {
          name: 'Post',
          collection: 'posts',
          fields: {
            ...postFields,
            author: { ...postFields.author, ref: 'Account' },
          },
        },
      ];
      const diff = await computeDiff(renamed, ddl);

      expect(diff.summary.alteredForeignKeys).toBe(1);
      expect(
        diff.operations.find((o) => o.type === 'alter-foreign-key'),
      ).toMatchObject({
        oldFk: { refTable: 'user' },
        newFk: { refTable: 'account' },
      });
    });

    it('no op when the action already matches', async () => {
      const ddl = syncedDdl();
      fkIn(ddl, { name: 'fk_posts_author', onDelete: 'CASCADE' });
      const diff = await computeDiff(irsWithAction('CASCADE'), ddl);

      expect(diff.summary.alteredForeignKeys).toBe(0);
      expect(diff.operations).toEqual([]);
      expect(diff.hasChanges).toBe(false);
    });

    it('one altered FK does not touch its neighbours', async () => {
      const ddl = syncedDdl();
      // Two refs on Post: author → User, editor → User. Only the first changes.
      const twoRefs: Record<string, IrField> = {
        ...postFields,
        editor: { type: 'ref', ref: 'User', nullable: true, unique: false },
      };
      ddl.setSchema(
        [{ name: 'users' }, { name: 'posts' }],
        {
          users: userColumns,
          posts: [
            ...postColumns,
            {
              name: 'editor',
              tableName: 'posts',
              dataType: 'integer',
              isNullable: true,
              defaultValue: null,
              isPrimary: false,
              isUnique: false,
            },
          ],
        },
        { users: [], posts: [] },
        {
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
            {
              name: 'fk_posts_editor',
              tableName: 'posts',
              columns: ['editor'],
              refTable: 'user',
              refColumns: ['id'],
              onDelete: 'NO ACTION',
              onUpdate: 'NO ACTION',
            },
          ],
        },
      );
      const diff = await computeDiff(
        [
          { name: 'User', collection: 'users', fields: userFields },
          {
            name: 'Post',
            collection: 'posts',
            fields: {
              ...twoRefs,
              author: { ...postFields.author, onDelete: 'CASCADE' },
            },
          },
        ],
        ddl,
      );

      expect(diff.summary.alteredForeignKeys).toBe(1);
      expect(
        diff.operations.filter((o) => o.type.endsWith('foreign-key')),
      ).toHaveLength(1);
      expect(
        diff.operations.find((o) => o.type === 'alter-foreign-key'),
      ).toMatchObject({ fkName: 'fk_posts_author' });
    });

    it('a missing FK with a differing action is still an add, not an alter', async () => {
      const ddl = syncedDdl();
      ddl.foreignKeys.set('posts', []);
      const diff = await computeDiff(irsWithAction('CASCADE'), ddl);

      expect(diff.summary.addedForeignKeys).toBe(1);
      expect(diff.summary.alteredForeignKeys).toBe(0);
      expect(
        diff.operations.find((o) => o.type === 'add-foreign-key'),
      ).toMatchObject({ fk: { onDelete: 'CASCADE' } });
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
