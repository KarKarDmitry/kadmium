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

const USERS = 5000;
const POSTS_PER_USER = 10;
const COMMENTS_PER_POST = 5;

// ── Seed ──

async function largeSeed(h: { orm: OrmManager; adapter: SqlAdapter }) {
  const totalPosts = USERS * POSTS_PER_USER;
  const totalComments = totalPosts * COMMENTS_PER_POST;
  console.log(
    `Seeding: ${USERS} users × ${POSTS_PER_USER} posts × ${COMMENTS_PER_POST} comments (${totalComments} comments)...`,
  );
  const t0 = performance.now();

  // Users — generate and insert in batches
  const userIds: number[] = [];
  for (let offset = 0; offset < USERS; offset += 1000) {
    const batch = Array.from(
      { length: Math.min(1000, USERS - offset) },
      (_, i) => {
        const idx = offset + i;
        return {
          name: `User ${idx}`,
          email: `user${idx}@bench.test`,
          age: 20 + (idx % 50),
          active: idx % 3 !== 0,
          registeredAt: new Date(
            `2024-01-${String((idx % 28) + 1).padStart(2, '0')}`,
          ),
        };
      },
    );
    const created = await h.orm.single(UserModel).createMany(batch).go();
    userIds.push(...created.map((r) => r.id));
  }

  // Posts — generate and insert in batches of 1000 rows
  const postIds: number[] = [];
  const totalPostRows = userIds.length * POSTS_PER_USER;
  for (let offset = 0; offset < totalPostRows; offset += 1000) {
    const batchSize = Math.min(1000, totalPostRows - offset);
    const batch = Array.from({ length: batchSize }, (_, i) => {
      const globalIdx = offset + i;
      const userIdx = Math.floor(globalIdx / POSTS_PER_USER);
      const p = globalIdx % POSTS_PER_USER;
      return {
        title: `Post ${p} by user`,
        content: `Content for post ${p}`,
        published: p % 2 === 0,
        views: p * 10,
        author: userIds[userIdx],
      };
    });
    const created = await h.orm.single(PostModel).createMany(batch).go();
    postIds.push(...created.map((r) => r.id));
  }

  // Comments — generate and insert in batches of 1000 rows
  const totalCommentRows = postIds.length * COMMENTS_PER_POST;
  for (let offset = 0; offset < totalCommentRows; offset += 1000) {
    const batchSize = Math.min(1000, totalCommentRows - offset);
    const batch = Array.from({ length: batchSize }, (_, i) => {
      const globalIdx = offset + i;
      const postIdx = Math.floor(globalIdx / COMMENTS_PER_POST);
      const c = globalIdx % COMMENTS_PER_POST;
      return {
        text: `Comment ${c}`,
        post: postIds[postIdx],
        user: userIds[c % userIds.length],
      };
    });
    await h.orm.single(CommentModel).createMany(batch).go();
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `Seeded: ${userIds.length} users, ${postIds.length} posts, ${totalCommentRows} comments in ${elapsed}s\n`,
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
  const h = { orm: kadmium.orm, adapter: kadmium.appCore.sqlAdapter! };

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
  await bench('1. select() all fields — single table (5000 rows)', async () => {
    await h.orm.single(UserModel).go();
  });

  // 2. Select with where — single table
  await bench('2. where() + select() — filtered (≈3333 rows)', async () => {
    await h.orm
      .single(UserModel)
      .where((u) => u.active.eq(true))
      .go();
  });

  // 3. Include to-many: user → posts
  await bench(
    '3. include() to-many — user → posts (10 posts each)',
    async () => {
      await h.orm
        .single(UserModel)
        .include({ posts: true })
        .go();
    },
  );

  // 4. Include nested: user → posts → author
  await bench('4. include() nested — user → posts → author', async () => {
    await h.orm
      .single(UserModel)
      .include({ posts: { include: { author: true } } })
      .go();
  });

  // 5. toSql() without execution
  await bench(
    '5. toSql() — SQL generation (no exec)',
    async () => {
      h.orm
        .single(UserModel)
        .include({ posts: true })
        .where((u) => u.active.eq(true))
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

  await bench(
    `6a. create() × ${N} — loop (1 query per row)`,
    async () => {
      benchRun++;
      for (let i = 0; i < N; i++) {
        await h.orm.single(UserModel).create(makeUserRow(i)).go();
      }
    },
    3,
  );

  await bench(
    `6b. createMany(${N}) — single batch query`,
    async () => {
      benchRun++;
      await h.orm
        .single(UserModel)
        .createMany(Array.from({ length: N }, (_, i) => makeUserRow(i)))
        .go();
    },
    3,
  );

  // ── Timing breakdown for include ──
  console.log('\n' + '═'.repeat(60));
  console.log('INCLUDE TIMING BREAKDOWN');
  console.log('═'.repeat(60));

  {
    const origToSql = h.adapter.toSql.bind(h.adapter);
    const origExecute = h.adapter.execute.bind(h.adapter);
    let sqlGenMs = 0,
      dbExecMs = 0,
      reshapeMs = 0;

    h.adapter.toSql = (sqb) => {
      const t0 = performance.now();
      const result = origToSql(sqb);
      sqlGenMs += performance.now() - t0;
      return result;
    };
    h.adapter.execute = async (sqb) => {
      const t1 = performance.now();
      const rows = await origExecute(sqb);
      dbExecMs += performance.now() - t1;
      return rows;
    };

    // Monkey-patch ResultReshaper to measure reshape time
    const { ResultReshaper } = await import('@karkardmitry/kadmium-sql-pg');
    const origReshape = ResultReshaper.reshape;
    ResultReshaper.reshape = (...args) => {
      const t2 = performance.now();
      const result = origReshape.apply(ResultReshaper, args);
      reshapeMs += performance.now() - t2;
      return result;
    };

    // Warmup
    await h.orm
      .single(UserModel)
      .include({ posts: true })
      .go();

    // Benchmark with timing
    const ITERS = 5;
    const totals: { sql: number; db: number; reshape: number }[] = [];
    for (let i = 0; i < ITERS; i++) {
      sqlGenMs = 0;
      dbExecMs = 0;
      reshapeMs = 0;
      await h.orm
        .single(UserModel)
        .include({ posts: true })
        .go();
      totals.push({ sql: sqlGenMs, db: dbExecMs, reshape: reshapeMs });
    }

    // Restore
    h.adapter.toSql = origToSql;
    h.adapter.execute = origExecute;
    ResultReshaper.reshape = origReshape;

    const avgSql = totals.reduce((s, t) => s + t.sql, 0) / ITERS;
    const avgDb = totals.reduce((s, t) => s + t.db, 0) / ITERS;
    const avgReshape = totals.reduce((s, t) => s + t.reshape, 0) / ITERS;
    const total = avgSql + avgDb + avgReshape;

    console.log(`include() to-many (5000 users × 10 posts):`);
    console.log(
      `  SQL generation:  ${avgSql.toFixed(1)}ms (${((avgSql / total) * 100).toFixed(0)}%)`,
    );
    console.log(
      `  DB execution:    ${avgDb.toFixed(1)}ms (${((avgDb / total) * 100).toFixed(0)}%)`,
    );
    console.log(
      `  Reshape:         ${avgReshape.toFixed(1)}ms (${((avgReshape / total) * 100).toFixed(0)}%)`,
    );
    console.log(`  Total:           ${total.toFixed(1)}ms`);
  }

  // ── Show actual SQL for include ──
  console.log('\n' + '═'.repeat(60));
  console.log('GENERATED SQL (include to-many)');
  console.log('═'.repeat(60));
  const includeQuery = h.orm
    .single(UserModel)
    .include({ posts: true })
    .limit(3);
  const sql = h.adapter.toSql(includeQuery.sqb);
  console.log(sql.text);
  console.log('params:', sql.values);

  console.log('\n' + '═'.repeat(60));
  console.log('Done. All benchmarks completed.');

  if (h.adapter.end) await h.adapter.end();
}

main().catch(console.error);
