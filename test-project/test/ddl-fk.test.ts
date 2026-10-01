/**
 * Миграция referential-действий на существующей базе.
 *
 * Юнит-тесты sql-pg проверяют, что дифф производит `alter-foreign-key`, а
 * текст превью содержит `ON DELETE CASCADE`. Здесь проверяется другое: что
 * Postgres действительно применяет смену действия к уже созданному
 * ограничению, и что каталог её показывает. Без сверки с каталогом тест
 * прошёл бы и на SQL, который никто не выполнил.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { makeHarness, type Harness } from './helpers';
import { resetAndSeed } from './fixtures';
import type { ReferentialAction } from '@karkardmitry/kadmium-core';
import {
  computeDiff,
  applyDiff,
  renderSql,
  checkHealth,
} from '@karkardmitry/kadmium-sql-pg';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
});

afterAll(async () => {
  await h.adapter.end();
});

beforeEach(async () => {
  await resetAndSeed(h);
});

interface FkRow {
  constraint_name: string;
  delete_rule: string;
  update_rule: string;
}

/** Каталог Postgres, а не наш собственный интроспект — независимая точка правды. */
async function catalogRule(
  constraintName: string,
): Promise<{ delete_rule: string; update_rule: string }> {
  const rows = (await h.adapter.ddl.raw(
    `SELECT constraint_name, delete_rule, update_rule
       FROM information_schema.referential_constraints
      WHERE constraint_name = $1`,
    [constraintName],
  )) as unknown as FkRow[];
  expect(rows, `constraint ${constraintName} must exist`).toHaveLength(1);
  return { delete_rule: rows[0].delete_rule, update_rule: rows[0].update_rule };
}

const POSTS_FK = 'fk_post_author';

/**
 * Копия набора IR с другим `onDelete` у `Post.author`.
 *
 * IR правится напрямую, а не через модель: тест проверяет миграцию против
 * базы, созданной из настоящих моделей, и не должен пересобирать реестр.
 */
function irsWithPostAction(action: ReferentialAction) {
  return h.app.allIrs.map((ir) =>
    ir.collection === 'post'
      ? {
          ...ir,
          fields: {
            ...ir.fields,
            author: { ...ir.fields.author, onDelete: action },
          },
        }
      : ir,
  );
}

/**
 * Применить IR с другим действием к существующей таблице.
 *
 * Отката нет: `beforeEach` дропает таблицы и синкает схему заново, поэтому
 * каждый тест начинается с CASCADE и порядок выполнения не важен.
 */
async function applyAction(action: ReferentialAction): Promise<void> {
  const target = irsWithPostAction(action);
  await applyDiff(await computeDiff(target, h.adapter.ddl), h.adapter.ddl);
}

describe('ddl: referential actions reach Postgres', () => {
  it('the DSL action was applied at schema creation', async () => {
    expect(await catalogRule(POSTS_FK)).toEqual({
      delete_rule: 'CASCADE',
      update_rule: 'NO ACTION',
    });
  });

  it('introspection reads back the action kadmium created', async () => {
    const fks = await h.adapter.ddl.inspectAllForeignKeys(['post']);
    expect(fks.find((f) => f.name === POSTS_FK)?.onDelete).toBe('CASCADE');
  });

  it('computeDiff sees no drift on a freshly synced schema', async () => {
    const diff = await computeDiff(h.app.allIrs, h.adapter.ddl);
    expect(diff.hasChanges).toBe(false);
    expect(diff.summary.alteredForeignKeys).toBe(0);
  });
});

describe('ddl: changing the action on an existing table', () => {
  it('produces one alter op — not a drop plus an add', async () => {
    const diff = await computeDiff(
      irsWithPostAction('RESTRICT'),
      h.adapter.ddl,
    );

    expect(diff.summary.alteredForeignKeys).toBe(1);
    expect(diff.summary.addedForeignKeys).toBe(0);
    expect(diff.summary.droppedForeignKeys).toBe(0);
    expect(diff.operations).toMatchObject([
      {
        type: 'alter-foreign-key',
        fkName: POSTS_FK,
        oldFk: { onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
        newFk: { onDelete: 'RESTRICT', onUpdate: 'NO ACTION' },
      },
    ]);
  });

  it('altering it really changes the constraint in Postgres', async () => {
    await applyAction('RESTRICT');
    expect(await catalogRule(POSTS_FK)).toEqual({
      delete_rule: 'RESTRICT',
      update_rule: 'NO ACTION',
    });
  });

  it('the constraint stays the same one, not a new one beside it', async () => {
    await applyAction('SET NULL');
    const fks = await h.adapter.ddl.inspectAllForeignKeys(['post']);
    expect(fks.filter((f) => f.columns[0] === 'author')).toHaveLength(1);
    expect(fks.find((f) => f.name === POSTS_FK)?.onDelete).toBe('SET NULL');
  });

  it('altering the action back is itself a diff, and re-syncs clean', async () => {
    await applyAction('RESTRICT');
    const back = await computeDiff(h.app.allIrs, h.adapter.ddl);
    expect(back.summary.alteredForeignKeys).toBe(1);

    await applyDiff(back, h.adapter.ddl);
    expect((await computeDiff(h.app.allIrs, h.adapter.ddl)).hasChanges).toBe(
      false,
    );
    expect((await catalogRule(POSTS_FK)).delete_rule).toBe('CASCADE');
  });
});

describe('ddl: checkHealth on a drifted action', () => {
  it('reports the action, and NOT a missing foreign key', async () => {
    const health = await checkHealth(
      irsWithPostAction('RESTRICT'),
      h.adapter.ddl,
    );

    expect(health.isHealthy).toBe(false);
    expect(health.issues).toContain(
      '1 foreign key(s) with a different referential action',
    );
    // FK на месте — покраснело бы «missing» только при drop + add.
    expect(health.issues).not.toContain('1 foreign key(s) missing');
  });
});

describe('ddl: RESTRICT vs NO ACTION', () => {
  it('differs only in deferral, so the DDL text is the assertion', async () => {
    // Поведенчески в kadmium неразличимы: обе запрещают удаление родителя при
    // живых детях. Разница в Postgres наблюдаема только для DEFERRABLE или при
    // нечувствительной к регистру коллации — ни того, ни другого DSL не даёт,
    // поэтому отдельный behavioral-тест был бы недостижим.
    const sql = renderSql(
      await computeDiff(irsWithPostAction('RESTRICT'), h.adapter.ddl),
    );

    expect(sql).toContain(
      'ALTER TABLE "post" DROP CONSTRAINT IF EXISTS "fk_post_author";',
    );
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).toContain('ON UPDATE NO ACTION');
  });
});
