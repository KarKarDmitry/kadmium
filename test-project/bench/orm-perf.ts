/**
 * Bench: реальная производительность ORM на большом сиде.
 *
 * Сидит N пользователей × M постов × K комментариев, затем замеряет:
 * 1. select() — все поля
 * 2. include() — to-many (user → posts)
 * 3. include() — nested (user → posts → author)
 * 4. multi-table join + groupBy + count
 *
 * Запуск: npx tsx bench/orm-perf.ts
 */
import { KadmiumApp, Model, OrmManager } from '@karkardmitry/kadmium-core';
import {
  User as UserModel,
  Post as PostModel,
  Comment as CommentModel,
} from '../src/models';
import { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

const USERS = 500;
const POSTS_PER_USER = 10;
const COMMENTS_PER_POST = 5;

// ── Seed ──

async function largeSeed(h: { orm: OrmManager; adapter: SqlAdapter }) {
  console.log(
    `Seeding: ${USERS} users × ${POSTS_PER_USER} posts × ${COMMENTS_PER_POST} comments...`,
  );
  const t0 = performance.now();

  const userIds: number[] = [];
  for (let i = 0; i < USERS; i++) {
    const u = await h.orm.single(UserModel).create({
      name: `User ${i}`,
      email: `user${i}@bench.test`,
      age: 20 + (i % 50),
      active: i % 3 !== 0,
      registeredAt: new Date(
        `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
      ),
    });
    userIds.push(u.id);
  }

  const postIds: number[] = [];
  for (const uid of userIds) {
    for (let p = 0; p < POSTS_PER_USER; p++) {
      const post = await h.orm.single(PostModel).create({
        title: `Post ${p} by user`,
        content: `Content for post ${p}`,
        published: p % 2 === 0,
        views: p * 10,
        author: uid,
      });
      postIds.push(post.id);
    }
  }

  let commentCount = 0;
  for (const pid of postIds) {
    for (let c = 0; c < COMMENTS_PER_POST; c++) {
      await h.orm.single(CommentModel).create({
        text: `Comment ${c}`,
        post: pid,
        user: userIds[c % userIds.length],
      });
      commentCount++;
    }
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `Seeded: ${userIds.length} users, ${postIds.length} posts, ${commentCount} comments in ${elapsed}s\n`,
  );
}

// ── Benchmark runner ──

async function bench(
  label: string,
  fn: () => Promise<void>,
  iterations = 5,
): Promise<void> {
  // Warmup
  await fn();

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(`${label}`);
  console.log(
    `  avg: ${avg.toFixed(1)}ms | min: ${min.toFixed(1)}ms | max: ${max.toFixed(1)}ms | ${iterations} runs`,
  );
}

// ── Main ──

async function main() {
  const kadmium = new KadmiumApp();
  await kadmium.init();
  const h = { orm: kadmium.orm, adapter: kadmium.appCore.sqlAdapter as any };

  // Clean + schema
  for (const t of await h.adapter.ddl.inspectTables()) {
    await h.adapter.ddl.dropTable(t.name);
  }
  const { computeDiff, applyDiff } =
    await import('@karkardmitry/kadmium-sql-pg');
  const diff = await computeDiff(kadmium.appCore.allIrs, h.adapter.ddl);
  await applyDiff(diff, h.adapter.ddl);

  await largeSeed(h);

  // ── Benchmarks ──

  console.log('═'.repeat(60));
  console.log('BENCHMARKS');
  console.log('═'.repeat(60));

  // 1. Select all fields — single table
  await bench('1. select() all fields — single table (500 rows)', async () => {
    await h.orm.single(UserModel).go();
  });

  // 2. Select with where — single table
  await bench('2. where() + select() — filtered (≈167 rows)', async () => {
    await h.orm
      .single(UserModel)
      .where((u: any) => u.active.eq(true))
      .go();
  });

  // 3. Include to-many: user → posts
  await bench(
    '3. include() to-many — user → posts (10 posts each)',
    async () => {
      await h.orm
        .single(UserModel)
        .include((u: any) => [u.posts])
        .go();
    },
  );

  // 4. Include nested: user → posts → author
  await bench('4. include() nested — user → posts → author', async () => {
    await h.orm
      .single(UserModel)
      .include((u: any) => [u.posts.include((p: any) => [p.author])])
      .go();
  });

  // 5. toSql() without execution
  await bench(
    '5. toSql() — SQL generation (no exec)',
    async () => {
      h.orm
        .single(UserModel)
        .include((u: any) => [u.posts])
        .where((u: any) => u.active.eq(true))
        .toSql();
    },
    20,
  );

  // 6. createMany vs loop create
  const N = 100;
  let benchRun = 0;
  const makeUserRow = (i: number) => ({
    name: `BenchUser${i}`,
    email: `bench${benchRun}_${i}@perf.test`,
    age: 20 + (i % 50),
    active: i % 2 === 0,
  });

  await bench(`6a. create() × ${N} — loop (1 query per row)`, async () => {
    benchRun++;
    for (let i = 0; i < N; i++) {
      await h.orm.single(UserModel).create(makeUserRow(i));
    }
  }, 3);

  await bench(`6b. createMany(${N}) — single batch query`, async () => {
    benchRun++;
    await h.orm
      .single(UserModel)
      .createMany(Array.from({ length: N }, (_, i) => makeUserRow(i)));
  }, 3);

  console.log('\n' + '═'.repeat(60));
  console.log('Done. All benchmarks completed.');

  await h.adapter.end();
}

main().catch(console.error);
