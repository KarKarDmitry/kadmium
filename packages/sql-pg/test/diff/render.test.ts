import { describe, it, expect } from 'vitest';
import { renderSql } from '../../src/diff/render';
import {
  addEmailIndexOp,
  addFkOp,
  addTitleColumnOp,
  alterAuthorTypeOp,
  alterNameNullableOp,
  createUsersOp,
  diff,
  dropCategoryFkOp,
  dropLegacyColumnOp,
  dropLegacyIndexOp,
  dropPostsOp,
} from './fixtures';
import type { DiffOp } from '../../src/diff/types';

describe('renderSql', () => {
  it('returns a no-op comment for an empty diff', () => {
    expect(renderSql(diff([]))).toBe('-- No changes needed.\n');
  });

  it('wraps operations in a transaction', () => {
    const sql = renderSql(diff([createUsersOp()]));
    expect(sql.startsWith('BEGIN;\n\n')).toBe(true);
    expect(sql.endsWith('\n\nCOMMIT;\n')).toBe(true);
  });

  it('renders create-table without inline unique for indexed columns', () => {
    const sql = renderSql(diff([createUsersOp(), addEmailIndexOp()]));
    expect(sql).toContain('CREATE TABLE "users" (');
    expect(sql).toContain('"email" character varying NOT NULL  UNIQUE');
    expect(sql).toContain('"id" serial NOT NULL PRIMARY KEY');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email");',
    );
  });

  it('renders every op type', () => {
    const ops: DiffOp[] = [
      addTitleColumnOp(),
      dropLegacyColumnOp(),
      alterAuthorTypeOp(),
      alterNameNullableOp(),
      dropLegacyIndexOp(),
      addFkOp(),
      dropCategoryFkOp(),
      dropPostsOp(),
    ];
    const sql = renderSql(diff(ops));

    expect(sql).toContain(
      'ALTER TABLE "posts" ADD COLUMN "title" character varying NOT NULL;',
    );
    expect(sql).toContain(
      'ALTER TABLE "posts" DROP COLUMN "legacy" CASCADE;',
    );
    expect(sql).toContain(
      'ALTER TABLE "posts" ALTER COLUMN "author" TYPE integer USING "author"::integer;',
    );
    expect(sql).toContain(
      'ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;',
    );
    expect(sql).toContain('DROP INDEX IF EXISTS "idx_posts_legacy";');
    expect(sql).toContain(
      'ALTER TABLE "posts" ADD CONSTRAINT "fk_posts_author" FOREIGN KEY ("author") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;',
    );
    expect(sql).toContain(
      'ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "fk_posts_category";',
    );
    expect(sql).toContain('DROP TABLE "posts" CASCADE;');
  });

  it('renders DROP NOT NULL for nullable alter-nullable', () => {
    const nullable = diff([
      { ...alterNameNullableOp(), oldNullable: false, newNullable: true },
    ]);
    expect(renderSql(nullable)).toContain(
      'ALTER TABLE "users" ALTER COLUMN "name" DROP NOT NULL;',
    );
  });

  it('asserts operations are SQL-safe', () => {
    const hostile = diff([
      {
        type: 'add-column',
        table: 'users',
        column: {
          name: 'bad"name',
          tableName: 'users',
          dataType: 'integer',
          isNullable: false,
          defaultValue: null,
          isPrimary: false,
          isUnique: false,
        },
      },
    ]);
    expect(() => renderSql(hostile)).toThrow(/Invalid SQL identifier/);
  });
});