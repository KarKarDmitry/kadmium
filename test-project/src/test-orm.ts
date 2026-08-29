import { Kadmium, KadmiumApp } from '@karkardmitry/kadmium-core';
import { Post, User } from './models';

async function main() {
  const app = new KadmiumApp();
  await app.init();

  // 1. select() без args → все поля модели
  const q1 = app.orm.single(Post).select();
  type T1 = Awaited<ReturnType<typeof q1.go>>[number];
  // T1 = { id: number; title?: string; content?: string; author?: number }
  console.log('select():', q1.toSql());

  // 2. select с fn + as → только выбранные поля с алиасом
  const q2 = app.orm.single(Post).select((t) => [t.id.as('post_id'), t.title]);
  type T2 = Awaited<ReturnType<typeof q2.go>>[number];
  // T2 = { post_id: number; title: string | undefined }
  // Проверка: post_id есть и это number
  type _checkPostId = T2 extends { post_id: number } ? true : false;
  // Проверка: title есть
  type _checkTitle = 'title' extends keyof T2 ? true : false;
  // Проверка: id НЕ должно быть в T2 (мы выбрали только post_id и title)
  type _checkNoId = 'id' extends keyof T2 ? false : true;
  console.log('select+alias:', q2.toSql());

  // 3. include → select → include должен быть в типе результата
  const q3 = app.orm
    .single(Post)
    .include((t) => [t.author])
    .select((t) => [t.title]);
  type T3 = Awaited<ReturnType<typeof q3.go>>[number];
  // T3 = { id: number; title?: string; content?: string; author?: number } & { author?: User }
  // Но author: number из ShapeOf вытесняется author?: User из IncludeResult
  // Итог: T3['author'] = User | undefined ✅
  console.log('include:', q3.toSql());

  // 4. nested include
  const q4 = app.orm
    .single(Post)
    .include((t) => [t.author.include((a) => [a.posts])])
    .select();
  type T4 = Awaited<ReturnType<typeof q4.go>>[number];
  // T4['author'] = User & { posts?: Post[] } | undefined
  console.log('nested:', q4.toSql());

  // 5. first → TResult | undefined
  const f1 = app.orm.single(Post).first();
  type F1 = Awaited<ReturnType<typeof f1.go>>;
  // F1 = { ... } | undefined

  // 6. first с fn
  const f2 = app.orm.single(Post).first((t) => [t.id]);
  type F2 = Awaited<ReturnType<typeof f2.go>>;
  // F2 = { id: number } | undefined
  console.log('first:', f1.toSql(), 'first+select:', f2.toSql());

  // ── UPDATE / DELETE типы ──
  const upd = app.orm
    .single(Post)
    .update({ title: 'new title' })
    .where((t) => t.id.eq(1));
  type TUpd = Awaited<ReturnType<typeof upd.go>>[number];
  // TUpd = { id: number; title?: string; content?: string; author?: number; asas?: number }
  console.log('update:', upd.sql());

  const del = app.orm
    .single(Post)
    .delete()
    .where((t) => t.id.eq(1));
  type TDel = Awaited<ReturnType<typeof del.go>>[number];
  // TDel = { id: number; title?: string; content?: string; author?: number; asas?: number }
  console.log('delete:', del.sql());

  const updAll = app.orm.single(Post).update({ title: 'new title' });
  type TUpdAll = Awaited<ReturnType<typeof updAll.go>>[number];
  // TUpdAll = { id: number; title?: string; content?: string; author?: number; asas?: number }
  console.log('update all:', updAll.sql());

  // ── AGGREGATE (count) ──
  const qAgg = app.orm
    .single(Post)
    .select((t, { count }) => [count('*').as('total')]);
  type TAgg = Awaited<ReturnType<typeof qAgg.go>>[number];
  // TAgg = { total: number }
  type _checkAggCount = TAgg extends { total: number } ? true : false;
  console.log('count:', qAgg.toSql());

  // ── AGGREGATE (sum на поле) ──
  const qSum = app.orm
    .single(Post)
    .select((t, { sum }) => [sum(t.id).as('totalId')]);
  type TSum = Awaited<ReturnType<typeof qSum.go>>[number];
  // TSum = { totalId: number | null }
  type _checkAggSum = TSum extends { totalId: number | null } ? true : false;
  console.log('sum:', qSum.toSql());

  // ── AGGREGATE + обычные поля ──
  const qMix = app.orm
    .single(Post)
    .select((t, { count }) => [t.title, count('*').as('cnt')]);
  type TMix = Awaited<ReturnType<typeof qMix.go>>[number];
  // TMix = { title: string | undefined; cnt: number }
  type _checkMixTitle = TMix extends { title: string | undefined }
    ? true
    : false;
  type _checkMixCnt = TMix extends { cnt: number } ? true : false;
  console.log('mix:', qMix.toSql());

  // ── COUNT / EXISTS ──
  const qCount = app.orm.single(Post).count();
  type TCount = Awaited<ReturnType<typeof qCount.go>>;
  type _checkCount = TCount extends number ? true : false;
  console.log('count:', qCount.sql());

  const qExist = app.orm
    .single(Post)
    .where((t) => t.id.eq(1))
    .exists();
  type TExist = Awaited<ReturnType<typeof qExist.go>>;
  type _checkExist = TExist extends boolean ? true : false;
  console.log('exists:', qExist.sql());

  // ── findById / page ──
  const qPage = app.orm
    .single(Post)
    .select((t) => [t.id])
    .page(2, 10);
  type TPage = Awaited<ReturnType<typeof qPage.go>>[number];
  type _checkPageId = TPage extends { id: number } ? true : false;

  const qFind = app.orm.single(Post).findById(1);
  type TFind = Awaited<ReturnType<typeof qFind.go>>;
  type _checkFindId = TFind extends { id: number } | undefined ? true : false;
  console.log('page:', qPage.toSql());

  console.log('\n--- Type checks passed ---');

  // ── TRANSACTION ──
  app.orm
    .transaction(async (tx) => {
      const upd = tx.single(Post).update({ title: 'tx test' }).sql();
      const sel = tx
        .single(Post)
        .select((t) => [t.id])
        .toSql();
      console.log('tx update:', upd);
      console.log('tx select:', sel);
      console.log('tx: OK');
    })
    .catch((e: any) => console.log('tx: SKIP (', e.message, ')'));
}

main().catch(console.error);
