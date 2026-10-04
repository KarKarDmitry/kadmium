/**
 * Готовые DiffOp для тестов движка применения.
 *
 * Операции — чистые данные, диалект тут ни при чём: apply разворачивает их в
 * вызовы `DbDdlAdapter`. Вынесены отдельно от `fixtures.ts`, где лежит
 * `MockDdl`, чтобы тесты apply не зависели от всего инвентаря compute-тестов.
 */
import type {
  AddColumnOp,
  AddForeignKeyOp,
  AddIndexOp,
  AlterDefaultOp,
  AlterForeignKeyOp,
  AlterNullableOp,
  AlterTypeOp,
  CreateTableOp,
  DbColumn,
  DbIndex,
  DiffOp,
  DiffResult,
  DropColumnOp,
  DropForeignKeyOp,
  DropIndexOp,
  DropTableOp,
} from '@karkardmitry/kadmium-sql-types';

export const userIndex: DbIndex = {
  name: 'idx_users_email',
  tableName: 'users',
  columns: ['email'],
  isUnique: true,
};

export const userPkColumn: DbColumn = {
  name: 'id',
  tableName: 'users',
  dataType: 'integer',
  isNullable: false,
  defaultValue: null,
  isPrimary: true,
  isUnique: true,
  autoIncrement: true,
};

export const createUsersOp = (): CreateTableOp => ({
  type: 'create-table',
  table: 'users',
  columns: [
    userPkColumn,
    {
      name: 'name',
      tableName: 'users',
      dataType: 'character varying',
      isNullable: false,
      defaultValue: null,
      isPrimary: false,
      isUnique: false,
    },
    {
      name: 'email',
      tableName: 'users',
      dataType: 'character varying',
      isNullable: false,
      defaultValue: null,
      isPrimary: false,
      isUnique: true,
    },
  ],
});

export const addEmailIndexOp = (): AddIndexOp => ({
  type: 'add-index',
  index: userIndex,
});

export const addTitleColumnOp = (): AddColumnOp => ({
  type: 'add-column',
  table: 'posts',
  column: {
    name: 'title',
    tableName: 'posts',
    dataType: 'character varying',
    isNullable: false,
    defaultValue: null,
    isPrimary: false,
    isUnique: false,
  },
});

export const dropLegacyColumnOp = (): DropColumnOp => ({
  type: 'drop-column',
  table: 'posts',
  columnName: 'legacy',
});

export const alterAuthorTypeOp = (): AlterTypeOp => ({
  type: 'alter-type',
  table: 'posts',
  columnName: 'author',
  oldType: 'bigint',
  newType: 'integer',
});

export const alterNameNullableOp = (): AlterNullableOp => ({
  type: 'alter-nullable',
  table: 'users',
  columnName: 'name',
  oldNullable: true,
  newNullable: false,
});

export const alterNameDefaultOp = (): AlterDefaultOp => ({
  type: 'alter-default',
  table: 'users',
  columnName: 'name',
  oldDefault: "'old'::character varying",
  newDefault: "'new'",
});

export const addFkOp = (): AddForeignKeyOp => ({
  type: 'add-foreign-key',
  fk: {
    name: 'fk_posts_author',
    tableName: 'posts',
    columns: ['author'],
    refTable: 'user',
    refColumns: ['id'],
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
});

export const dropCategoryFkOp = (): DropForeignKeyOp => ({
  type: 'drop-foreign-key',
  fkName: 'fk_posts_category',
  tableName: 'posts',
});

export const alterAuthorFkOp = (): AlterForeignKeyOp => ({
  type: 'alter-foreign-key',
  fkName: 'fk_posts_author',
  tableName: 'posts',
  oldFk: {
    name: 'fk_posts_author',
    tableName: 'posts',
    columns: ['author'],
    refTable: 'user',
    refColumns: ['id'],
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
  newFk: {
    name: 'fk_posts_author',
    tableName: 'posts',
    columns: ['author'],
    refTable: 'user',
    refColumns: ['id'],
    onDelete: 'CASCADE',
    onUpdate: 'NO ACTION',
  },
});

export const addLegacyIndexOp = (): AddIndexOp => ({
  type: 'add-index',
  index: {
    name: 'idx_posts_legacy',
    tableName: 'posts',
    columns: ['legacy'],
    isUnique: false,
  },
});

export const dropLegacyIndexOp = (): DropIndexOp => ({
  type: 'drop-index',
  indexName: 'idx_posts_legacy',
  tableName: 'posts',
});

export const dropPostsOp = (): DropTableOp => ({
  type: 'drop-table',
  table: 'posts',
});

export function diff(
  operations: DiffOp[],
  summary?: Partial<DiffResult['summary']>,
): DiffResult {
  return {
    operations,
    hasChanges: operations.length > 0,
    summary: {
      addedTables: 0,
      droppedTables: 0,
      addedColumns: 0,
      droppedColumns: 0,
      alteredColumns: 0,
      alteredDefaults: 0,
      addedIndexes: 0,
      droppedIndexes: 0,
      addedForeignKeys: 0,
      droppedForeignKeys: 0,
      alteredForeignKeys: 0,
      ...summary,
    },
  };
}
