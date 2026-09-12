import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { and, or } from '@karkardmitry/kadmium-core';
import {
  User as UserModel,
  Post as PostModel,
  Comment as CommentModel,
} from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed } from '../fixtures';

let h: Harness;

// Максимальный типизированный сид: 5 юзеров, 6 постов, 5 комментариев.
let ids: {
  alice: number;
  bob: number;
  carol: number;
  dave: number;
  eve: number;
  p1: number;
  p2: number;
  p3: number;
  p5: number;
  p6: number;
};

async function seedMax(): Promise<void> {
  const users = await h.orm
    .single(UserModel)
    .select((u) => [u.id, u.name])
    .go();
  const byName = (name: string) => users.find((u) => u.name === name)!.id;

  const posts = await h.orm
    .single(PostModel)
    .select((p) => [p.id, p.title])
    .go();
  const byTitle = (title: string) => posts.find((p) => p.title === title)!.id;

  // Доп. юзеры
  const dave = await h.orm
    .single(UserModel)
    .create({
      name: 'Dave',
      email: 'dave@test.com',
      age: 22,
      active: true,
      registeredAt: new Date('2024-04-01T00:00:00Z'),
    })
    .go();
  const eve = await h.orm
    .single(UserModel)
    .create({
      name: 'Eve',
      email: 'eve@test.com',
      age: 35,
      active: true,
      registeredAt: new Date('2024-04-15T00:00:00Z'),
    })
    .go();

  // Доп. посты
  const p4 = await h.orm
    .single(PostModel)
    .create({
      title: 'Alice Addon',
      content: 'addon body',
      published: true,
      views: 3,
      author: byName('Alice'),
    })
    .go();
  const p5 = await h.orm
    .single(PostModel)
    .create({
      title: 'Bob Draft',
      content: 'bob draft body',
      published: false,
      views: 1,
      author: byName('Bob'),
    })
    .go();
  const p6 = await h.orm
    .single(PostModel)
    .create({
      title: 'Carol Post',
      content: 'carol body',
      published: true,
      views: 15,
      author: byName('Carol'),
    })
    .go();

  // Доп. комментарии: wow → Draft Post (alice), yeah → Bob Draft (bob)
  await h.orm
    .single(CommentModel)
    .create({
      text: 'wow',
      post: byTitle('Draft Post'),
      user: byName('Alice'),
    })
    .go();
  await h.orm
    .single(CommentModel)
    .create({
      text: 'yeah',
      post: p5.id,
      user: byName('Bob'),
    })
    .go();

  ids = {
    alice: byName('Alice'),
    bob: byName('Bob'),
    carol: byName('Carol'),
    dave: dave.id,
    eve: eve.id,
    p1: byTitle('Hello Postgres'),
    p2: byTitle('Draft Post'),
    p3: byTitle('Bob Writes'),
    p5: p5.id,
    p6: p6.id,
  };
}

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
  await seedMax();
});

afterAll(async () => {
  await h.adapter.end();
});

const log = (label: string, sql: string, values?: unknown[]) => {
  console.log(`\n── ${label} ──`);
  console.log(sql);
  if (values?.length) console.log('params:', values);
};

// ═════════════════════════════════════════════════════════════════════
// Kitchen-sink: весь API в одном месте с максимальным сидом.
//
// Юзеры: Alice(30, active), Bob(25, inactive), Carol(40, active),
//        Dave(22, active), Eve(35, active)
// Посты: p1 Hello Postgres(10, pub, Alice), p2 Draft Post(0, unpub, Alice),
//        p3 Bob Writes(5, pub, Bob), p4 Alice Addon(3, pub, Alice),
//        p5 Bob Draft(1, unpub, Bob), p6 Carol Post(15, pub, Carol)
// Комменты: nice!(alice→p1), lgtm(bob→p1), meh(carol→p3),
//           wow(alice→p2), yeah(bob→p5)
// ═════════════════════════════════════════════════════════════════════

describe('kitchen-sink: full API integration', () => {
  it('0. seed verified', async () => {
    const users = await h.orm.single(UserModel).count().go();
    const posts = await h.orm.single(PostModel).count().go();
    const comments = await h.orm.single(CommentModel).count().go();
    expect(users).toBe(5);
    expect(posts).toBe(6);
    expect(comments).toBe(5);
  });

  // ── SELECT + WHERE + ORDER + LIMIT ────────────────────────────────
  it('1. select + where + order + limit', async () => {
    const q = h.orm
      .single(PostModel)
      .where((p) => p.published.eq(true))
      .order((p) => [p.views.desc])
      .limit(3)
      .select((p) => [p.title, p.views, p.author]);
    log('1. select + where + order + limit', q.toSql());

    const rows = await q.go();
    expect(rows).toHaveLength(3);
    expect(rows[0].title).toBe('Carol Post'); // views 15
    expect(rows[0].views).toBeGreaterThan(rows[1].views);
  });

  // ── first() + select projection ───────────────────────────────────
  it('2. first() + select projection', async () => {
    const q = h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .first((u) => [u.id, u.email]);
    log('2. first() + select', q.toSql());

    const row = await q.go();
    expect(row).toBeDefined();
    expect(row!.email).toBe('alice@test.com');
    expect('name' in row!).toBe(false);
  });

  // ── count() + exists() ────────────────────────────────────────────
  it('3. count() and exists()', async () => {
    const q = h.orm
      .single(PostModel)
      .where((p) => p.published.eq(true))
      .count();
    log('3a. count(published)', q.sql());
    expect(await q.go()).toBe(4);

    const qe = h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .exists();
    log('3b. exists(alice)', qe.sql());
    expect(await qe.go()).toBe(true);

    const qn = h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Zara'))
      .exists();
    expect(await qn.go()).toBe(false);
  });

  // ── AND / OR composition ──────────────────────────────────────────
  it('4. where: and() + or() nested expression', async () => {
    const q = h.orm
      .single(UserModel)
      .where((u) => and(u.active.eq(true), or(u.age.gte(35), u.name.eq('Bob'))))
      .select((u) => [u.name, u.age])
      .order((u) => [u.name.asc]);
    log('4. where: and/or', q.toSql());

    const rows = await q.go();
    // active=true: Alice(30), Carol(40), Dave(22), Eve(35)
    // OR(age>=35 | name=Bob): Carol(40), Eve(35), Bob(неактивный)
    // Итого: Carol, Eve
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(['Carol', 'Eve']);
  });

  // ── page() ────────────────────────────────────────────────────────
  it('5. page(): offset pagination', async () => {
    const q1 = h.orm
      .single(UserModel)
      .order((u) => [u.name.asc])
      .page(1, 2)
      .select((u) => [u.name]);
    log('5. page(1,2)', q1.toSql());
    expect(await q1.go()).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);

    const q2 = h.orm
      .single(UserModel)
      .order((u) => [u.name.asc])
      .page(2, 2)
      .select((u) => [u.name]);
    expect(await q2.go()).toEqual([{ name: 'Carol' }, { name: 'Dave' }]);
  });

  // ── clone() ───────────────────────────────────────────────────────
  it('6. clone(): branch without mutating the base', async () => {
    const base = h.orm
      .single(PostModel)
      .where((p) => p.published.eq(true))
      .order((p) => [p.views.desc]);

    const q1 = base
      .clone()
      .limit(1)
      .select((p) => [p.title]);
    log('6. clone top-1', q1.toSql());

    const top1 = await q1.go();
    const top2 = await base
      .clone()
      .limit(2)
      .select((p) => [p.title])
      .go();
    expect(top1).toHaveLength(1);
    expect(top2).toHaveLength(2);
    expect(top1[0].title).toBe('Carol Post');
    expect(top1[0].title).toBe(top2[0].title);
  });

  // ── aggregates + grouping + having ────────────────────────────────
  it('7. aggregates + groupBy + having + havingOr', async () => {
    const q = h.orm
      .single(PostModel)
      .select((p, { agg }) => [
        p.author,
        agg.count('*').as('cnt'),
        agg.sum(p.views).as('totalViews'),
      ])
      .groupBy((p) => [p.author])
      .having((t) => t.totalViews.gt(5))
      .havingOr((t) => t.cnt.gte(3));
    log('7. agg + having', q.toSql());

    const rows = await q.go();
    // Alice: cnt=3, total=13; Bob: cnt=2, total=6; Carol: cnt=1, total=15
    expect(rows).toHaveLength(3);
  });

  // ── window functions ──────────────────────────────────────────────
  it('8. window functions: row_number/rank/lead/windowed sum', async () => {
    const q = h.orm
      .single(PostModel)
      .order((p) => [p.author.asc, p.views.desc])
      .select((p, { wf, agg }) => [
        p.title,
        p.author,
        p.views,
        wf.rowNumber().partitionBy(p.author).orderBy(p.views.desc).as('rn'),
        wf.rank().partitionBy(p.author).orderBy(p.views.desc).as('rank'),
        wf.lead(p.views, 1, 0).orderBy(p.author.asc).as('nextViews'),
        agg.sum(p.views).over().partitionBy(p.author).as('authorTotal'),
      ]);
    log('8. window functions', q.toSql());

    const rows = await q.go();
    expect(rows).toHaveLength(6);
    // author ASC: Alice(Hello 10, Addon 3, Draft 0), Bob(Writes 5, Draft 1), Carol(Post 15)
    expect(rows[0].title).toBe('Hello Postgres');
    expect(rows[0].rn).toBe(1);
    expect(rows[0].rank).toBe(1);
    expect(rows[0].authorTotal).toBe(13);
    expect(rows.find((r) => r.title === 'Bob Writes')!.authorTotal).toBe(6);
    expect(rows[5].authorTotal).toBe(15);
  });

  // ── multi-table join ──────────────────────────────────────────────
  it('9. multi-table join: post × user × comment', async () => {
    const q = h.orm
      .query({ p: PostModel, u: UserModel, c: CommentModel })
      .join({ left: 'p', right: 'u', on: (t) => t.p.author.eq(t.u.id) })
      .join({ left: 'c', right: 'p', on: (t) => t.c.post.eq(t.p.id) })
      .where((t) => t.p.title.eq('Hello Postgres'))
      .order((t) => [t.c.text.asc])
      .select((t) => [t.u.name, t.p.title, t.c.text]);
    log('9. multi join', q.toSql());

    const rows = await q.go();
    expect(rows).toHaveLength(2); // nice!, lgtm → 2 комментария
    expect(rows.every((r) => r.p.title === 'Hello Postgres')).toBe(true);
    expect(rows[0].c.text).toBe('lgtm'); // sorted asc
  });

  // ── include to-one + to-many ──────────────────────────────────────
  it('10. include: post.author to-one + user.posts to-many', async () => {
    const qp = h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include({ author: true })
      .first();
    log('10a. include to-one', qp.toSql());
    const post = await qp.go();
    expect(post).toBeDefined();
    expect(post!.author!.name).toBe('Alice');

    const qu = h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({
        posts: {
          select: (p) => [p.title, p.views],
          order: (p) => [p.views.desc],
        },
      })
      .first();
    log('10b. include to-many', qu.toSql());
    const alice = await qu.go();
    expect(alice!.posts).toHaveLength(3);
    expect(alice!.posts[0].views).toBeGreaterThanOrEqual(alice!.posts[1].views);
  });

  // ── update().returning() ──────────────────────────────────────────
  it('11. update().returning() projection', async () => {
    const q = h.orm
      .single(PostModel)
      .update({ views: 0 })
      .where((p) => p.title.eq('Draft Post'))
      .returning((p) => [p.id, p.title, p.views]);
    log('11. update returning', q.sql());

    const rows = await q.go();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Draft Post');
    expect(rows[0].views).toBe(0);
    expect('content' in rows[0]).toBe(false);
  });

  // ── delete().returning() ──────────────────────────────────────────
  it('12. delete().returning()', async () => {
    const q = h.orm
      .single(CommentModel)
      .delete()
      .where((c) => c.text.eq('yeah'))
      .returning((c) => [c.id, c.text]);
    log('12. delete returning', q.sql());

    const rows = await q.go();
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('yeah');
  });

  // ── transaction ───────────────────────────────────────────────────
  it('13. transaction: commit', async () => {
    await h.orm.transaction(async (tx) => {
      const created = await tx
        .single(UserModel)
        .create({
          name: 'TxUser',
          email: 'tx@test.com',
          age: 99,
          active: true,
          registeredAt: new Date('2024-06-15T00:00:00Z'),
        })
        .go();
      expect(created.id).toBeDefined();
    });
    const found = await h.orm
      .single(UserModel)
      .where((u) => u.email.eq('tx@test.com'))
      .first()
      .go();
    expect(found?.name).toBe('TxUser');
  });

  // ── multi-column groupBy + min/max ────────────────────────────────
  it('14. multi-column groupBy + min/max', async () => {
    const q = h.orm
      .single(PostModel)
      .select((p, { agg }) => [
        p.author,
        p.published,
        agg.count('*').as('cnt'),
        agg.min(p.views).as('minViews'),
        agg.max(p.views).as('maxViews'),
      ])
      .groupBy((p) => [p.author, p.published])
      .order((p) => [p.author.asc]);
    log('14. multi-col groupBy', q.toSql());

    const rows = await q.go();
    expect(rows).toHaveLength(5);
    const alicePublished = rows.find(
      (r) => r.author === ids.alice && r.published === true,
    );
    expect(alicePublished!.cnt).toBe(2); // p1(10), p4(3)
    expect(alicePublished!.minViews).toBe(3);
    expect(alicePublished!.maxViews).toBe(10);
  });

  // ── multi join + aggregate + window ───────────────────────────────
  it('15. query: join + window row_number/partition sum', async () => {
    const q = h.orm
      .query({ p: PostModel, u: UserModel })
      .join({ left: 'p', right: 'u', on: (t) => t.p.author.eq(t.u.id) })
      .order((t) => [t.u.name.asc, t.p.views.desc])
      .select((t, { agg, wf }) => [
        t.u.name,
        t.p.title,
        t.p.views,
        wf.rowNumber().partitionBy(t.u.name).orderBy(t.p.views.desc).as('rn'),
        agg.sum(t.p.views).over().partitionBy(t.u.name).as('authorTotal'),
      ]);
    log('15. query join + agg + window', q.toSql());

    const rows = await q.go();
    expect(rows).toHaveLength(6);
    expect(rows[0].u.name).toBe('Alice');
    expect(rows[0].rn).toBe(1);
    expect(rows[0].authorTotal).toBe(13);
    expect(rows[1].rn).toBe(2);
    expect(rows[2].rn).toBe(3);
    expect(rows[3].u.name).toBe('Bob');
    expect(rows[3].authorTotal).toBe(6);
    expect(rows[5].u.name).toBe('Carol');
    expect(rows[5].authorTotal).toBe(15);
  });

  // ── nested include ────────────────────────────────────────────────
  it('16. nested include: user → posts → comments', async () => {
    const q = h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({
        posts: {
          select: (p) => [p.title],
          order: (p) => [p.views.desc],
          include: { comments: true },
        },
      })
      .first();
    log('16. nested include', q.toSql());

    const alice = await q.go();
    expect(alice!.posts).toHaveLength(3);
    const hello = alice!.posts.find((p) => p.title === 'Hello Postgres');
    expect(hello!.comments).toHaveLength(2); // nice!, lgtm
  });

  // ── window + having in one query ──────────────────────────────────
  it('17. windowed aggregate + having', async () => {
    const q = h.orm
      .single(PostModel)
      .select((p, { agg }) => [
        p.author,
        agg.count('*').as('cnt'),
        agg.count('*').over().as('totalPosts'),
      ])
      .groupBy((p) => [p.author])
      .having((t) => t.cnt.gte(2));
    log('17. window + having', q.toSql());

    const rows = await q.go();
    // Alice: cnt=3; Bob: cnt=2; Carol: cnt=1 отсекается. totalPosts — окно над агрегатом.
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.cnt === 3)!.totalPosts).toBe(2); // COUNT(*) OVER () — после HAVING (2 группы)
  });

  // ── in() + between() ──────────────────────────────────────────────
  it('18. in() + between()', async () => {
    const ids = (
      await h.orm
        .single(UserModel)
        .where((u) => u.name.in(['Alice', 'Bob']))
        .select((u) => [u.id])
        .go()
    ).map((r) => r.id);

    const q = h.orm
      .single(UserModel)
      .where((u) => u.id.in(ids))
      .select((u) => [u.name, u.age])
      .order((u) => [u.name.asc]);
    log('18a. in()', q.toSql());

    const rows = await q.go();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob']);

    const qb = h.orm
      .single(UserModel)
      .where((u) => u.age.between(25, 35))
      .select((u) => [u.name, u.age])
      .order((u) => [u.age.asc]);
    log('18b. between()', qb.toSql());

    const rowsB = await qb.go();
    expect(rowsB.map((r) => r.name)).toEqual(['Bob', 'Alice', 'Eve']);
  });

  // ── string filters ────────────────────────────────────────────────
  it('19. start() + ilike()', async () => {
    const q = h.orm
      .single(UserModel)
      .where((u) => u.name.start('A'))
      .select((u) => [u.name]);
    log('19. start(A)', q.toSql());

    const rows = await q.go();
    expect(rows.map((r) => r.name)).toEqual(['Alice']);

    const rowsB = await h.orm
      .single(UserModel)
      .where((u) => u.name.ilike('%ob'))
      .select((u) => [u.name])
      .go();
    expect(rowsB.map((r) => r.name)).toEqual(['Bob']);
  });

  // ── everything combined ───────────────────────────────────────────
  it('20. composite: or-where + rank + lead + windowed avg', async () => {
    const q = h.orm
      .single(PostModel)
      .where((p) => or(p.published.eq(true), p.views.gt(0)))
      .select((p, { wf, agg }) => [
        p.title,
        p.author,
        p.views,
        wf.rank().orderBy(p.views.desc).as('globalRank'),
        wf.lead(p.views, 1, 0).orderBy(p.views.desc).as('nextViews'),
        agg.avg(p.views).over().as('globalAvg'),
      ])
      .order((p) => [p.views.desc])
      .limit(4);
    log('20. composite', q.toSql());

    const rows = await q.go();
    // published OR views>0 → 5 строк: Carol(15), Hello(10), BobWrites(5), Addon(3), BobDraft(1)
    expect(rows).toHaveLength(4);
    expect(rows[0].title).toBe('Carol Post');
    expect(rows[0].globalRank).toBe(1);
    expect(rows[0].nextViews).toBe(10);
    // avg по окну из 5 строк: (15+10+5+3+1)/5 = 6.8; numeric-строка → Number()
    expect(Number(rows[0].globalAvg)).toBe(6.8);
  });
});
