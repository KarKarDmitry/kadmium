const { KadmiumApp } = require('@karkardmitry/kadmium-core');

async function main() {
  const app = new KadmiumApp();
  await app.init('.');
  const adapter = app.appCore.sqlAdapter;

  console.log('=== LEFT JOIN + GROUP BY ===');
  const gj = await adapter.raw(
    "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " +
    'SELECT "User"."id", "User"."name", "User"."email", "User"."age", ' +
    '"User"."active", "User"."registeredAt", ' +
    "COALESCE(json_agg(json_build_object('id', p.\"id\", 'title', p.\"title\", " +
    "'content', p.\"content\", 'published', p.\"published\", 'views', p.\"views\", " +
    "'author', p.\"author\")) FILTER (WHERE p.\"id\" IS NOT NULL), '[]'::json) AS posts " +
    'FROM "user" AS "User" ' +
    'LEFT JOIN "post" AS p ON p."author" = "User"."id" ' +
    'GROUP BY "User"."id", "User"."name", "User"."email", ' +
    '"User"."age", "User"."active", "User"."registeredAt"'
  );
  gj.forEach(r => console.log(r['QUERY PLAN']));

  console.log('\n=== LATERAL (current) ===');
  const lat = await adapter.raw(
    "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " +
    'SELECT "User".*, "__inc_posts"."posts" AS "posts" ' +
    'FROM "user" AS "User" ' +
    'LEFT JOIN LATERAL (' +
    "  SELECT COALESCE(json_agg(subq), '[]'::json) AS \"posts\" " +
    '  FROM (' +
    '    SELECT "posts"."id" AS "posts.id", "posts"."title" AS "posts.title", ' +
    '           "posts"."content" AS "posts.content", "posts"."published" AS "posts.published", ' +
    '           "posts"."views" AS "posts.views", "posts"."author" AS "posts.author" ' +
    '    FROM "post" AS "posts" WHERE "posts"."author" = "User"."id"' +
    '  ) AS subq' +
    ') AS "__inc_posts" ON true'
  );
  lat.forEach(r => console.log(r['QUERY PLAN']));

  await adapter.end();
  process.exit(0);
}
main();
