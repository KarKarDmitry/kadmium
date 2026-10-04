/**
 * Уникальность, которую `.oneToOne()` обещает сам.
 *
 * Юнит-тест sql-pg проверяет, что `expectedIndexes()` помечает индекс
 * уникальным. Здесь проверяется другое: что PostgreSQL действительно создал
 * уникальный индекс и что он отвергает дубль. Индекс без UNIQUE прошёл бы
 * юнит-тест и при этом тихо пропустил бы вторую запись.
 *
 * Схема пересобирается целиком в `beforeEach`: часть тестов снимает
 * уникальность, чтобы проверить обратный переход.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { pgDialect } from '@karkardmitry/kadmium-sql-pg';
import { makeHarness, type Harness } from './helpers';
import { resetSchemaAndSeed, type SeedData } from './fixtures';
import { User as UserModel, Profile as ProfileModel } from '../src/models';
import { computeDiff } from '@karkardmitry/kadmium-core';
import { applyDiff } from '@karkardmitry/kadmium-core';
import { renderSql } from '@karkardmitry/kadmium-sql-pg';

let h: Harness;
let seed: SeedData;

beforeAll(async () => {
  h = await makeHarness();
});

afterAll(async () => {
  await h.adapter.end();
});

beforeEach(async () => {
  seed = await resetSchemaAndSeed(h);
});

interface IndexRow {
  indexname: string;
  indexdef: string;
}

/** Каталог Postgres, а не наша интроспекция — независимая точка правды. */
async function catalogIndex(table: string): Promise<IndexRow | undefined> {
  const rows = (await h.adapter.ddl.raw(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`,
    [table],
  )) as unknown as IndexRow[];
  return rows.find((r) => r.indexname === `idx_${table}_user`);
}

/**
 * IR с неуникальным индексом на `profile.user`.
 *
 * IR правится напрямую, а не через модель: тест проверяет миграцию против
 * базы, созданной из настоящих моделей, и не должен пересобирать реестр.
 */
function irsWithNonUniqueProfileUser() {
  return h.app.allIrs.map((ir) =>
    ir.collection === 'profile'
      ? {
          ...ir,
          fields: {
            ...ir.fields,
            user: { ...ir.fields.user, relation: 'many-to-one' as const },
          },
        }
      : ir,
  );
}

describe('ddl: oneToOne() produces a unique index', () => {
  it('the index the DSL asked for exists and is UNIQUE', async () => {
    const idx = await catalogIndex('profile');
    expect(idx, 'idx_profile_user must exist').toBeDefined();
    expect(idx!.indexdef).toContain('UNIQUE');
  });

  it('introspection reads the uniqueness back as unique', async () => {
    const indexes = await h.adapter.ddl.inspectAllIndexes(['profile']);
    expect(indexes.find((i) => i.name === 'idx_profile_user')?.isUnique).toBe(
      true,
    );
  });

  it('a second profile for the same user is rejected by Postgres', async () => {
    const { alice } = seed;
    await h.orm
      .insert(ProfileModel)
      .values({ displayName: 'First', user: alice.id })
      .go();

    // 23505 — unique_violation. Именно его и должен дать индекс, а не код
    // kadmium: дубль отсекает база, а не ORM.
    const error = await h.orm
      .insert(ProfileModel)
      .values({ displayName: 'Second', user: alice.id })
      .go()
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: '23505' });
  });

  it('different users still get their own profile', async () => {
    const { alice, bob } = seed;
    await h.orm
      .insert(ProfileModel)
      .values({ displayName: 'Alice Profile', user: alice.id })
      .go();
    await h.orm
      .insert(ProfileModel)
      .values({ displayName: 'Bob Profile', user: bob.id })
      .go();

    const all = await h.orm.select(ProfileModel).go();
    expect(all.length).toBe(2);
    expect(all.map((p) => p.displayName).sort()).toEqual([
      'Alice Profile',
      'Bob Profile',
    ]);
  });
});

describe('ddl: oneToOne() and computeDiff agree', () => {
  it('no drift on a freshly synced schema', async () => {
    const diff = await computeDiff(h.app.allIrs, h.adapter.ddl, pgDialect);
    expect(diff.hasChanges).toBe(false);
  });

  it('dropping the uniqueness is a diff that Postgres really applies', async () => {
    const target = irsWithNonUniqueProfileUser();
    const diff = await computeDiff(target, h.adapter.ddl, pgDialect);

    expect(diff.summary.droppedIndexes).toBe(1);
    expect(diff.summary.addedIndexes).toBe(1);
    // drop обязан идти раньше add, иначе CREATE INDEX упрётся в старый.
    expect(
      diff.operations
        .filter((o) => o.type === 'drop-index' || o.type === 'add-index')
        .map((o) => o.type),
    ).toEqual(['drop-index', 'add-index']);

    await applyDiff(diff, h.adapter.ddl);

    const idx = await catalogIndex('profile');
    expect(idx?.indexdef).not.toContain('UNIQUE');
    // И теперь дубль проходит — ограничение действительно снято, а не просто
    // исчезло из наших ожиданий.
    const { alice } = seed;
    await h.orm
      .insert(ProfileModel)
      .values({ displayName: 'First', user: alice.id })
      .go();
    await h.orm
      .insert(ProfileModel)
      .values({ displayName: 'Second', user: alice.id })
      .go();
  });

  it('the preview agrees with what apply does', async () => {
    const sql = renderSql(
      await computeDiff(
        irsWithNonUniqueProfileUser(),
        h.adapter.ddl,
        pgDialect,
      ),
    );

    expect(sql).toContain('DROP INDEX IF EXISTS "idx_profile_user"');
    // Неуникальный CREATE INDEX — обратное состояние, а не уникальный:
    // превью обязано совпадать с тем, что выполнит db:migrate.
    expect(sql).toContain('CREATE INDEX "idx_profile_user"');
    expect(sql).not.toContain('CREATE UNIQUE INDEX "idx_profile_user"');
  });
});
