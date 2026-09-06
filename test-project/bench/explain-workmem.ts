import { KadmiumApp } from '@karkardmitry/kadmium-core';

async function main() {
  const app = new KadmiumApp();
  await app.init('.');
  const adapter = app.appCore.sqlAdapter!;

  // Set work_mem high
  await adapter.raw('SET work_mem = "256MB"');

  console.log('=== LEFT JOIN + GROUP BY (work_mem=256MB) ===');
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
      '"User"."age", "User"."active", "User"."registeredAt"',
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r1.forEach((r: any) => console.log(r['QUERY PLAN']));

  console.log('\n=== LATERAL (work_mem=256MB) ===');
  const r2 = await adapter.raw(
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
  r2.forEach((r: any) => console.log(r['QUERY PLAN']));

  await adapter.raw('RESET work_mem');
  await adapter.end();
  process.exit(0);
}
main();
