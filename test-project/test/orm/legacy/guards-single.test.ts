import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  Post as PostModel,
  Comment as CommentModel,
} from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed } from '../../fixtures';

/**
 * Runtime-гарды ORM на легаси-поверхности `single()`.
 *
 * Зачем: без гардов sql-pg рендерит UPDATE/DELETE/INSERT только из данных
 * и wheres, поэтому limit/offset/order/cursor/groupBy в DML и wheres в
 * INSERT отбрасываются МОЛЧА — запрос уходит в БД с другим смыслом, чем
 * написал разработчик. Кейсы ниже фиксируют эту границу: что бросает,
 * с каким текстом и что данные при этом остаются нетронутыми.
 *
 * Почему файл в legacy/: эти проверки достижимы только на билдере, где
 * limit/order/cursor/groupBy ещё можно вызвать ДО DML. У нового explicit
 * API (`orm.update/delete/insert`) таких шагов нет в интерфейсе вовсе —
 * на нём до этих гардов просто не дойти, там ловит компилятор.
 * Гарды остаются defense-in-depth для JS и динамики.
 *
 * Модульные тесты самих функций — в packages/core/test/orm/guards.test.ts
 * (чистый AST без БД). Здесь — сквозной путь через реальный Postgres:
 * важно, что гард ловит ДО похода в базу.
 *
 * limit/offset/page/order/cursor сужены НА ТИПАХ (DmlConfigHandle теряет
 * DML после этих шагов), поэтому вызовы помечены `@ts-expect-error`: он не
 * просто глушит ошибку, а падает сам, если сужение когда-нибудь откатят.
 * groupBy намеренно НЕ сужен (`groupBy(): this` в SingleShared) — его
 * кейсы только рантайм-проверки. select() НЕ сужен: `sqb.selects`
 * рендерится как RETURNING, поэтому select() перед update()/delete() —
 * валидный путь и проверяется отдельно.
 */

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

/** Количество строк в таблице — чтобы доказать, что гард не изменил данные. */
async function countPosts(): Promise<number> {
  return h.orm.single(PostModel).count().go();
}

describe('guards: DML + limit/offset (самая дорогая ошибка)', () => {
  it('delete(): limit(1) бросает, а не удаляет все подходящие строки', () => {
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => h.orm.single(PostModel).limit(1).delete()).toThrow(
      /limit\(\)\/page\(\)\/offset\(\) is not supported with delete\(\)/,
    );
  });

  it('delete(): page() и offset() ловятся тем же гардом', () => {
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => h.orm.single(PostModel).page(1, 10).delete()).toThrow(
      /not supported with delete\(\)/,
    );
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => h.orm.single(PostModel).offset(5).delete()).toThrow(
      /not supported with delete\(\)/,
    );
  });

  it('update(): limit(1) бросает', () => {
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => h.orm.single(PostModel).limit(1).update({ views: 1 })).toThrow(
      /limit\(\)\/page\(\)\/offset\(\) is not supported with update\(\)/,
    );
  });

  it('create()/createMany(): limit и page бросают', () => {
    const data = { title: 'x', content: 'y', author: 1 };
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => h.orm.single(PostModel).limit(1).create(data)).toThrow(
      /not supported with create\(\)/,
    );
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => h.orm.single(PostModel).page(1, 5).createMany([data])).toThrow(
      /not supported with create\(\)/,
    );
  });

  it('сообщение объясняет, почему шаг потерялся, и что делать', () => {
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => h.orm.single(PostModel).limit(1).delete()).toThrow(
      /PostgreSQL UPDATE\/DELETE\/INSERT have no LIMIT — the adapter drops it silently\./,
    );
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => h.orm.single(PostModel).limit(1).delete()).toThrow(
      /Narrow the rows with where\(\) instead/,
    );
  });

  it('гард срабатывает до обращения к БД: данные не тронуты', async () => {
    const before = await countPosts();
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => h.orm.single(PostModel).limit(1).delete()).toThrow();
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => h.orm.single(PostModel).offset(2).delete()).toThrow();
    expect(() =>
      // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
      h.orm.single(PostModel).limit(1).update({ views: 0 }),
    ).toThrow();
    expect(await countPosts()).toBe(before);
  });

  it('готовая запись для не-бинарной проверки остаётся нетронутой', async () => {
    const [p] = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .select((p) => [p.views])
      .go();
    expect(() =>
      // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
      h.orm.single(PostModel).limit(1).update({ views: -1 }),
    ).toThrow();
    const [after] = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .select((p) => [p.views])
      .go();
    expect(after.views).toBe(p.views);
  });

  it('select() перед update() — это RETURNING, DML сохранён', async () => {
    const [before] = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .select((p) => [p.id, p.views])
      .go();
    // Без @ts-expect-error: select() не сужает DML — selects идут в RETURNING
    const updated = await h.orm
      .single(PostModel)
      .select((p) => [p.id, p.views])
      .where((p) => p.id.eq(before.id))
      .update({ views: before.views + 1 })
      .go();
    expect(updated[0]).toMatchObject({
      id: before.id,
      views: before.views + 1,
    });
    // возвращаем сид как был, чтобы не протекать в другие тесты
    await h.orm
      .single(PostModel)
      .where((p) => p.id.eq(before.id))
      .update({ views: before.views })
      .go();
  });
});

describe('guards: DML + order/cursor', () => {
  it('update(): order() бросает', () => {
    expect(() =>
      h.orm
        .single(PostModel)
        .order((p) => [p.views.desc])
        // @ts-expect-error DML сужен на типах: order не рендерится в DML
        .update({ views: 1 }),
    ).toThrow(/order\(\)\/cursor\(\) is not supported with update\(\)/);
  });

  it('update(): order() + cursor() бросает на order', () => {
    expect(() =>
      h.orm
        .single(PostModel)
        .order((p) => [p.id.asc])
        .cursor((p) => p.id.gt(0))
        // @ts-expect-error DML сужен на типах: cursor не рендерится в DML
        .update({ views: 1 }),
    ).toThrow(/order\(\)\/cursor\(\) is not supported with update\(\)/);
  });

  it('delete(): order() бросает', () => {
    expect(() =>
      h.orm
        .single(PostModel)
        .order((p) => [p.id.asc])
        // @ts-expect-error DML сужен на типах: order не рендерится в DML
        .delete(),
    ).toThrow(/not supported with delete\(\)/);
  });

  it('create()/createMany(): order() бросает', () => {
    const data = { title: 'x', content: 'y', author: 1 };
    expect(() =>
      h.orm
        .single(PostModel)
        .order((p) => [p.id.asc])
        // @ts-expect-error DML сужен на типах: order не рендерится в DML
        .create(data),
    ).toThrow(/not supported with create\(\)/);
    expect(() =>
      h.orm
        .single(PostModel)
        .order((p) => [p.id.asc])
        // @ts-expect-error DML сужен на типах: order не рендерится в DML
        .createMany([data]),
    ).toThrow(/not supported with create\(\)/);
  });
});

describe('guards: DML + groupBy', () => {
  it('update()/delete() бросают на groupBy', () => {
    expect(() =>
      h.orm
        .single(PostModel)
        .groupBy((p) => [p.author])
        .update({ views: 1 }),
    ).toThrow(/groupBy\(\) is not supported with update\(\)/);
    expect(() =>
      h.orm
        .single(PostModel)
        .groupBy((p) => [p.author])
        .delete(),
    ).toThrow(/groupBy\(\) is not supported with delete\(\)/);
  });

  it('create()/createMany() бросают на groupBy', () => {
    const data = { title: 'x', content: 'y', author: 1 };
    expect(() =>
      h.orm
        .single(PostModel)
        .groupBy((p) => [p.author])
        .create(data),
    ).toThrow(/groupBy\(\) is not supported with create\(\)/);
    expect(() =>
      h.orm
        .single(PostModel)
        .groupBy((p) => [p.author])
        .createMany([data]),
    ).toThrow(/not supported with create\(\)/);
  });

  it('подсказка предлагает сначала агрегировать, потом писать по id', () => {
    expect(() =>
      h.orm
        .single(PostModel)
        .groupBy((p) => [p.author])
        .delete(),
    ).toThrow(/Aggregate on a select first/);
  });
});

describe('guards: INSERT + where (тихая потеря фильтра)', () => {
  it('create(): where() бросает — иначе строка создалась бы всегда', () => {
    expect(() =>
      h.orm
        .single(PostModel)
        .where((p) => p.title.eq('Hello Postgres'))
        .create({ title: 'x', content: 'y', author: 1 }),
    ).toThrow(/where\(\) is not supported with create\(\)/);
  });

  it('create(): сообщение называет причину и альтернативу', () => {
    expect(() =>
      h.orm
        .single(PostModel)
        .where((p) => p.title.eq('Hello Postgres'))
        .create({ title: 'x', content: 'y', author: 1 }),
    ).toThrow(/INSERT has no WHERE clause — the filter is dropped silently\./);
    expect(() =>
      h.orm
        .single(PostModel)
        .where((p) => p.title.eq('Hello Postgres'))
        .create({ title: 'x', content: 'y', author: 1 }),
    ).toThrow(/check the condition in your code/);
  });

  it('createMany(): where() бросает', () => {
    expect(() =>
      h.orm
        .single(PostModel)
        .where((p) => p.title.eq('Hello Postgres'))
        .createMany([{ title: 'x', content: 'y', author: 1 }]),
    ).toThrow(/not supported with create\(\)/);
  });

  it('гард срабатывает до INSERT: строк не добавилось', async () => {
    const before = await countPosts();
    expect(() =>
      h.orm
        .single(PostModel)
        .where((p) => p.title.eq('Hello Postgres'))
        .create({ title: 'x', content: 'y', author: 1 }),
    ).toThrow();
    expect(await countPosts()).toBe(before);
  });

  it('where() без DML работает как обычно — гард не срабатывает зря', async () => {
    const rows = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .select((p) => [p.title])
      .go();
    expect(rows).toHaveLength(1);
  });

  it('DML без запрещённых шагов работает (гард не мешает)', async () => {
    const created = await h.orm
      .single(PostModel)
      .create({ title: 'Guard Ok', content: 'c', author: 1 })
      .go();
    expect(created.id).toBeDefined();
    const updated = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Guard Ok'))
      .update({ views: 7 })
      .go();
    expect(updated).toHaveLength(1);
    const deleted = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Guard Ok'))
      .delete()
      .go();
    expect(deleted).toHaveLength(1);
  });
});

describe('guards: точка срабатывания и копии билдера', () => {
  it('ошибка прилетает на строке сборки запроса, а не в терминале', () => {
    // Строка ниже — место, где написано несовместимое. Если бы гард ждал
    // go()/execute(), ошибка всплыла бы позже и в другом стеке.
    const builder = h.orm.single(PostModel).limit(1);
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => builder.delete()).toThrow(/not supported with delete\(\)/);
  });

  it('clone() не снимает гард: копия билдера проверяется так же', () => {
    const base = h.orm.single(PostModel).limit(1);
    // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
    expect(() => base.clone().delete()).toThrow(
      /not supported with delete\(\)/,
    );
  });

  it('гард срабатывает до clone/where — порядок вызовов не важен', () => {
    expect(() =>
      h.orm
        .single(PostModel)
        .where((p) => p.title.eq('Hello Postgres'))
        .limit(1)
        // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
        .delete(),
    ).toThrow(/not supported with delete\(\)/);
  });

  it('returning() и upsert-путь не обходят гард', () => {
    // returning() — это шаг финализатора после update(), гард уже сработал выше.
    expect(() =>
      // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
      h.orm.single(PostModel).limit(1).update({ views: 1 }),
    ).toThrow();
    expect(() =>
      h.orm
        .single(CommentModel)
        .limit(1)
        // @ts-expect-error DML сужен на типах: шаг не рендерится в DML
        .create({ text: 'x', post: null, user: null }),
    ).toThrow(/not supported with create\(\)/);
  });
});
