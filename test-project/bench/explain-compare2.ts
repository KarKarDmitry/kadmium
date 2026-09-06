import { KadmiumApp } from '@karkardmitry/kadmium-core';

async function main() {
  const app = new KadmiumApp();
  await app.init();
  const adapter = app.appCore.sqlAdapter;

  if (!adapter) {
    console.log('failed bench: adapter undefined');
    return;
  }
  // HashAggregate для LEFT JOIN + GROUP BY
  console.log('=== LEFT JOIN + HashAggregate ===');
  const r1 = await adapter.raw(
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ' +
      'SELECT "User"."id", "User"."name", "User"."email", "User"."age", ' +
      '"User"."active", "User"."registeredAt", ' +
      'COALESCE(json_agg(json_build_object(\'id\', p."id", \'title\', p."title", ' +
      '\'content\', p."content", \'published\', p."published", \'views\', p."views", ' +
      '\'author\', p."author")) FILTER (WHERE p."id" IS NOT NULL), \'[]\'::json) AS posts ' +
      'FROM "user" AS "User" ' +
      'LEFT JOIN "post" AS p ON p."author" = "User"."id" ' +
      'GROUP BY "User"."id", "User"."name", "User"."email", ' +
      '"User"."age", "User"."active", "User"."registeredAt" ' +
      'ORDER BY "User"."id"',
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r1.forEach((r: any) => console.log(r['QUERY PLAN']));

  // CTE approach
  console.log('\n=== CTE ===');
  const r2 = await adapter.raw(
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ' +
      'WITH post_json AS (' +
      '  SELECT author, json_agg(json_build_object(\'id\', p."id", \'title\', p."title", ' +
      '\'content\', p."content", \'published\', p."published", \'views\', p."views", ' +
      '\'author\', p."author")) AS posts ' +
      '  FROM "post" p GROUP BY author' +
      ') ' +
      'SELECT "User"."id", "User"."name", "User"."email", "User"."age", ' +
      '"User"."active", "User"."registeredAt", ' +
      "COALESCE(pj.posts, '[]'::json) AS posts " +
      'FROM "user" AS "User" ' +
      'LEFT JOIN post_json pj ON pj.author = "User"."id"',
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r2.forEach((r: any) => console.log(r['QUERY PLAN']));

  // LATERAL for reference
  console.log('\n=== LATERAL (current) ===');
  const r3 = await adapter.raw(
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ' +
      'SELECT "User".*, "__inc_posts"."posts" AS "posts" ' +
      'FROM "user" AS "User" ' +
      'LEFT JOIN LATERAL (' +
      '  SELECT COALESCE(json_agg(subq), \'[]\'::json) AS "posts" ' +
      '  FROM (' +
      '    SELECT "posts"."id" AS "posts.id", "posts"."title" AS "posts.title", ' +
      '           "posts"."content" AS "posts.content", "posts"."published" AS "posts.published", ' +
      '           "posts"."views" AS "posts.views", "posts"."author" AS "posts.author" ' +
      '    FROM "post" AS "posts" WHERE "posts"."author" = "User"."id"' +
      '  ) AS subq' +
      ') AS "__inc_posts" ON true',
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r3.forEach((r: any) => console.log(r['QUERY PLAN']));

  if (adapter.end) await adapter.end();
  process.exit(0);
}
main();
