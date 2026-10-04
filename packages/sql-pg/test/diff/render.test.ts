import { describe, it, expect } from 'vitest';
import { renderSql } from '../../src/diff/render';
import {
  addEmailIndexOp,
  addFkOp,
  addTitleColumnOp,
  alterAuthorFkOp,
  alterAuthorTypeOp,
  alterNameNullableOp,
  alterNameDefaultOp,
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

  it('preview matches the exact executed DDL (single source of truth)', () => {
    // Инлайн UNIQUE у email здесь отсутствует намеренно: applyDiff его
    // вырезает, потому что уникальность обеспечивает отдельный индекс.
    // Если бы превью его печатало, `db:sql` отдавал бы файл, отличный от
    // того, что сделает `db:migrate`.
    expect(renderSql(diff([createUsersOp(), addEmailIndexOp()]))).toBe(
      `BEGIN;

CREATE TABLE "users" (
  "id" serial NOT NULL PRIMARY KEY,
  "name" character varying NOT NULL,
  "email" character varying NOT NULL
);

CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email");

COMMIT;
`,
    );
  });

  it('renders create-table without inline unique for indexed columns', () => {
    const sql = renderSql(diff([createUsersOp(), addEmailIndexOp()]));
    expect(sql).toContain('CREATE TABLE "users" (');
    expect(sql).toContain('"email" character varying NOT NULL');
    expect(sql).not.toContain('"email" character varying NOT NULL  UNIQUE');
    expect(sql).toContain('"id" serial NOT NULL PRIMARY KEY');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email");',
    );
  });

  it('keeps inline unique for a column that gets no index op', () => {
    // У колонки без своего индекса вырезать нечего — снять UNIQUE нечем,
    // и колоночное ограничение остаётся единственным носителем.
    const sql = renderSql(diff([createUsersOp()]));
    expect(sql).toContain('"email" character varying NOT NULL  UNIQUE');
  });

  it('renders DROP DEFAULT when the model has no default', () => {
    const drop = diff([{ ...alterNameDefaultOp(), newDefault: null }]);
    expect(renderSql(drop)).toContain(
      'ALTER TABLE "users" ALTER COLUMN "name" DROP DEFAULT;',
    );
  });

  it('renders every op type', () => {
    const ops: DiffOp[] = [
      addTitleColumnOp(),
      dropLegacyColumnOp(),
      alterAuthorTypeOp(),
      alterNameNullableOp(),
      alterNameDefaultOp(),
      dropLegacyIndexOp(),
      addFkOp(),
      dropCategoryFkOp(),
      dropPostsOp(),
    ];
    const sql = renderSql(diff(ops));

    expect(sql).toContain(
      'ALTER TABLE "posts" ADD COLUMN "title" character varying NOT NULL;',
    );
    expect(sql).toContain('ALTER TABLE "posts" DROP COLUMN "legacy" CASCADE;');
    expect(sql).toContain(
      'ALTER TABLE "posts" ALTER COLUMN "author" TYPE integer USING "author"::integer;',
    );
    expect(sql).toContain(
      'ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;',
    );
    expect(sql).toContain(
      'ALTER TABLE "users" ALTER COLUMN "name" SET DEFAULT \'new\';',
    );
    expect(sql).toContain('DROP INDEX IF EXISTS "idx_posts_legacy";');
    expect(sql).toContain(
      'ALTER TABLE "posts" ADD CONSTRAINT "fk_posts_author"\n       FOREIGN KEY ("author") REFERENCES "user" ("id")\n       ON DELETE NO ACTION ON UPDATE NO ACTION;',
    );
    expect(sql).toContain(
      'ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "fk_posts_category";',
    );
    expect(sql).toContain('DROP TABLE IF EXISTS "posts" CASCADE;');
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

  describe('alter-foreign-key', () => {
    it('renders DROP CONSTRAINT before ADD CONSTRAINT', () => {
      const sql = renderSql(diff([alterAuthorFkOp()]));
      const drop = sql.indexOf('DROP CONSTRAINT IF EXISTS "fk_posts_author"');
      const add = sql.indexOf('ADD CONSTRAINT "fk_posts_author"');
      expect(drop).toBeGreaterThan(-1);
      expect(add).toBeGreaterThan(drop);
    });

    it('the recreated constraint carries the new action', () => {
      const sql = renderSql(diff([alterAuthorFkOp()]));
      expect(sql).toContain('ON DELETE CASCADE ON UPDATE NO ACTION');
      expect(sql).not.toContain('ON DELETE NO ACTION ON UPDATE NO ACTION');
    });

    it('renders both actions when both changed', () => {
      const op = alterAuthorFkOp();
      const sql = renderSql(
        diff([
          {
            ...op,
            newFk: { ...op.newFk, onDelete: 'SET NULL', onUpdate: 'SET NULL' },
          },
        ]),
      );
      expect(sql).toContain('ON DELETE SET NULL ON UPDATE SET NULL');
    });

    it('a poisoned new FK is rejected — it would be interpolated as SQL', () => {
      const op = alterAuthorFkOp();
      const hostile = diff([
        {
          ...op,
          newFk: { ...op.newFk, refTable: 'user" ; DROP TABLE users; --' },
        },
      ]);
      expect(() => renderSql(hostile)).toThrow(/Invalid SQL identifier/);
    });

    it('a poisoned old FK is rejected too — it reaches DROP CONSTRAINT', () => {
      const op = alterAuthorFkOp();
      const hostile = diff([
        { ...op, oldFk: { ...op.oldFk, tableName: 'post"s' } },
      ]);
      expect(() => renderSql(hostile)).toThrow(/Invalid SQL identifier/);
    });

    it('an unknown action is rejected on both sides', () => {
      const op = alterAuthorFkOp();
      expect(() =>
        renderSql(
          diff([
            {
              ...op,
              newFk: {
                ...op.newFk,
                onDelete: 'EXPLODE' as (typeof op.newFk)['onDelete'],
              },
            },
          ]),
        ),
      ).toThrow(/Invalid referential action for ON DELETE/);
      expect(() =>
        renderSql(
          diff([
            {
              ...op,
              oldFk: {
                ...op.oldFk,
                onUpdate: 'EXPLODE' as (typeof op.oldFk)['onUpdate'],
              },
            },
          ]),
        ),
      ).toThrow(/Invalid referential action for ON UPDATE/);
    });
  });
});
