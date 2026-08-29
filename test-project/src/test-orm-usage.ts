import { KadmiumApp } from '@karkardmitry/kadmium-core';
import { User, Post, Comment } from './models';

async function main() {
  const app = new KadmiumApp();
  await app.init();

  // ── 3. Basic Select (all public fields) ──
  {
    const q = app.orm.single(User).select();
    type T = Awaited<ReturnType<typeof q.go>>[number];
    // T = { id: number; name?: string; email?: string }
    console.log('3. select():', q.toSql());
  }

  // ── 4. Select specific fields with alias ──
  {
    const q = app.orm
      .single(User)
      .select((u) => [u.name.as('userName'), u.email]);
    type T = Awaited<ReturnType<typeof q.go>>[number];
    // T = { userName: string; email: string | undefined }
    console.log('4. select+alias:', q.toSql());
  }

  // ── 5. Where clause (simple) + first ──
  {
    const q = app.orm
      .single(User)
      .where((u) => u.name.eq('Alice'))
      .first();
    type T = Awaited<ReturnType<typeof q.go>>;
    // T = { id: number; name?: string; email?: string } | undefined
    console.log('5. where+first:', q.toSql());
  }

  // ── 6. Complex where (AND/OR groups) ──
  {
    const q = app.orm
      .single(User)
      .where((u) => u.name.eq('Alice'))
      .and((u) => u.email.eq('alice@test.com'))
      .or((u) => u.name.eq('Bob'))
      .first();
    type T = Awaited<ReturnType<typeof q.go>>;
    console.log('6. complex where:', q.toSql());
  }

  // ── 7. Order by + limit ──
  {
    const q = app.orm
      .single(User)
      .select((u) => [u.name])
      .order((u) => u.name, 'desc')
      .limit(1);
    type T = Awaited<ReturnType<typeof q.go>>[number];
    // T = { name: string | undefined }
    console.log('7. order+limit:', q.toSql());
  }

  // ── 8. Limit and Offset ──
  {
    const q = app.orm.single(User).select().limit(5).offset(2);
    type T = Awaited<ReturnType<typeof q.go>>[number];
    console.log('8. limit+offset:', q.toSql());
  }

  // ── 14. Include ToOne Relation (author on Post) ──
  {
    const q = app.orm
      .single(Post)
      .include((p) => [p.author])
      .first();
    type T = Awaited<ReturnType<typeof q.go>>;
    // T = (ShapeOf<Post> & { author: UserShape }) | undefined
    // author содержит id, name, email
    console.log('14. include to-one:', q.toSql());
  }

  // ── 15. Include ToMany with where/order/limit/as ──
  {
    const q = app.orm
      .single(User)
      .include((u) => [
        u.posts
          .where((p) => p.title.like('test'))
          .order((p) => p.title, 'desc')
          .limit(1)
          .as('myPosts'),
      ])
      .select();
    type T = Awaited<ReturnType<typeof q.go>>[number];
    // T = ShapeOf<User> & { myPosts?: PostShape[] }
    console.log('15. include to-many+filter:', q.toSql());
    // Проверка: p.title.as('x') в order — ошибка TS
    // .order((p) => p.title.as('x')) — ❌ 'as' does not exist on type 'OrderField'
  }

  // ── 16. Include ToMany Relation (comments) ──
  {
    const q = app.orm
      .single(Post)
      .include((p) => [p.comments])
      .select();
    type T = Awaited<ReturnType<typeof q.go>>[number];
    // T = ShapeOf<Post> & { comments?: CommentShape[] }
    console.log('16. include comments:', q.toSql());
  }

  // ── 17. Multiple includes ──
  {
    const q = app.orm
      .single(Post)
      .include((p) => [p.author, p.comments])
      .select((p) => [p.id, p.title.as('postTitle')]);
    type T = Awaited<ReturnType<typeof q.go>>[number];
    // T = { id: number; postTitle: string | undefined } & { author?: User; comments?: Comment[] }
    console.log('17. multiple includes:', q.toSql());
  }

  // ── 18. Nested Include (author → posts → comments?) ──
  // В старой версии: User → Post → Comment → User
  // У нас: Post → author (User) → posts (Post)
  {
    const q = app.orm
      .single(Post)
      .include((p) => [p.author.include((a) => [a.posts])])
      .select();
    type T = Awaited<ReturnType<typeof q.go>>[number];
    const t = await q.go()
    // T = ShapeOf<Post> & { author: UserShape & { posts?: PostShape[] } }
    console.log('18. nested include:', q.toSql());
  }

  // ── group() — вложенные группы условий ──
  {
    const q = app.orm
      .single(Post)
      .where((t) => t.id.gt(0))
      .group((q) =>
        q.where((t) => t.title.like('foo')).or((t) => t.title.like('bar')),
      )
      .select();
    console.log('group:', q.toSql());
    // WHERE "id" > 0 AND ("title" LIKE '%foo%' OR "title" LIKE '%bar%')
  }

  // ── group() на finalizer ──
  {
    const q = app.orm
      .single(Post)
      .select()
      .where((t) => t.id.gt(0))
      .group((q) =>
        q.where((t) => t.title.like('foo')).or((t) => t.title.like('bar')),
      );
    console.log('group on finalizer:', q.toSql());
    // WHERE "id" > 0 AND ("title" LIKE '%foo%' OR "title" LIKE '%bar%')
  }

  // ── 19. Multi-query (User + Post join) ──
  {
    const q = app.orm
      .query({ u: User, p: Post })
      .join({
        left: 'u',
        right: 'p',
        on: (t) => t.u.id.eq(t.p.id),
      })
      .where((t) => t.u.name.eq('Alice'))
      .select((t) => [t.u.name, t.p.title]);
    type T19 = Awaited<ReturnType<typeof q.go>>[number];
    // T19 = Record<string, unknown>
    console.log('19. multi-query:', q.toSql());
    // SELECT "u"."name", "p"."title" FROM "User"
    //   INNER JOIN "Post" AS "p" ON "u"."id" = "p"."id"
    //   WHERE "u"."name" = 'Alice'
  }

  // ── 20. Multi-query with groupBy ──
  {
    const q = app.orm
      .query({ u: User, p: Post })
      .join({
        left: 'u',
        right: 'p',
        on: (t) => t.u.id.eq(t.p.id),
      })
      .where((t) => t.u.name.eq('Alice'))
      .groupBy((t) => [t.u.name])
      .select((t) => [t.u.name]);
    type T20 = Awaited<ReturnType<typeof q.go>>[number];
    console.log('20. multi-query+groupBy:', q.toSql());
  }

  // ── 23. Multi-query with aggregate (count) ──
  {
    const q = app.orm
      .query({ u: User, p: Post })
      .join({
        left: 'u',
        right: 'p',
        on: (t) => t.u.id.eq(t.p.id),
      })
      .groupBy((t) => [t.u.name])
      .select((t, { count }) => [t.u.name, count(t.p.id).as('postCount')]);
    type T23 = Awaited<ReturnType<typeof q.go>>[number];
    // T23 = Record<string, unknown>
    console.log('23. multi-query+count:', q.toSql());
  }

  // ── 24. Multi-query with sum aggregate ──
  {
    const q = app.orm
      .query({ u: User, p: Post })
      .join({
        left: 'u',
        right: 'p',
        on: (t) => t.u.id.eq(t.p.id),
      })
      .groupBy((t) => [t.u.name])
      .select((t, { sum }) => [t.u.name, sum(t.p.id).as('totalId')]);
    type T24 = Awaited<ReturnType<typeof q.go>>[number];
    console.log('24. multi-query+sum:', q.toSql());
  }

  // ── 25. Multi-query with include ──
  {
    const q = app.orm
      .query({ u: User, p: Post })
      .join({
        left: 'u',
        right: 'p',
        on: (t) => t.u.id.eq(t.p.id),
      })
      .include((t) => [t.p.author])
      .select((t) => [t.u.name, t.p.title]);
    type T25 = Awaited<ReturnType<typeof q.go>>[number];
    // T25 = { u: { name: string | undefined }; p: { title: string | undefined } }
    type _check25Name = T25 extends { u: { name: string | undefined } }
      ? true
      : false;
    type _check25Title = T25 extends { p: { title: string | undefined } }
      ? true
      : false;
    type _check25NoExtra = 'author' extends keyof T25 ? false : true;
    console.log('25. multi-query+include:', q.toSql());
  }

  // ── 26. Multi-query with nested include ──
  {
    const q = app.orm
      .query({ u: User, p: Post })
      .join({
        left: 'u',
        right: 'p',
        on: (t) => t.u.id.eq(t.p.id),
      })
      .include((t) => [t.p.author.include((a) => [a.posts])])
      .select((t) => [t.u.name]);
    type T26 = Awaited<ReturnType<typeof q.go>>[number];
    const t = await q.go()
    // T26 = { u: { name: string | undefined } }
    type _check26Name = T26 extends { u: { name: string | undefined } }
      ? true
      : false;

    console.log('26. multi-query+nested include:', q.toSql());
  }

  // ── 21. Include subquery через адаптер ──
  {
    const sql = app.orm
      .single(Post)
      .include((t) => [t.author.include((a) => [a.posts])])
      .select((t) => [t.id, t.title])
      .toSql();
    console.log('21. nested include:', sql);
  }

  // ── 22. Multi-query через адаптер ──
  {
    const sql = app.orm
      .query({ u: User, p: Post })
      .join({
        left: 'u',
        right: 'p',
        on: (t) => t.u.id.eq(t.p.id),
      })
      .where((t) => t.u.name.eq('Alice'))
      .select((t) => [t.u.name, t.p.title])
      .toSql();
    console.log('22. multi-query:', sql);
  }

  console.log('\nAll type checks OK');
}

main().catch(console.error);
