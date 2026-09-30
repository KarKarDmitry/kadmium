import { describe, expect, it } from 'vitest';
import {
  buildUpsertManySql,
  buildInsertManySql,
  createManyRows,
  createRow,
  type ManyRowsSqlBuilder,
  type QueryFn,
} from '../src/helpers';
import { SqlGenerator, type ParamState } from '../src/sql-generator';

class TestGenerator extends SqlGenerator {}
import { maxBatchRows } from '../src/batch';

/**
 * Функциональные тесты публичных хелперов записи: что реально уходит в БД
 * (SQL + параметры) и что возвращается наружу.
 *
 * `queryFn` подменён, поэтому проверяется ровно то, что адаптер отправит
 * PostgreSQL — без knowledge о внутреннем рендерере.
 */
function fakeQueryFn(rows: unknown[][]): {
  fn: QueryFn;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  let i = 0;
  const fn: QueryFn = async (text, values) => {
    calls.push({ text, values: values ?? [] });
    return { rows: rows[i++] ?? [] };
  };
  return { fn, calls };
}

describe('createRow', () => {
  it('отправляет один параметризованный INSERT и возвращает вставленную строку', async () => {
    const { fn, calls } = fakeQueryFn([[{ id: 1, title: 'a' }]]);

    const row = await createRow(fn, 'post', { title: 'a' });

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe(
      'INSERT INTO "post" ("title") VALUES ($1) RETURNING *',
    );
    expect(calls[0].values).toEqual(['a']);
    expect(row).toEqual({ id: 1, title: 'a' });
  });

  it('значения не интерполируются в SQL', async () => {
    const { fn, calls } = fakeQueryFn([[{}]]);

    await createRow(fn, 'post', { title: "'; DROP TABLE post; --" });

    expect(calls[0].text).not.toContain('DROP TABLE');
    expect(calls[0].values).toEqual(["'; DROP TABLE post; --"]);
  });

  it('returning рендерер ограничивает проекцию', async () => {
    const { fn, calls } = fakeQueryFn([[{ title: 'a' }]]);

    await createRow(fn, 'post', { title: 'a' }, () => '"title"');

    expect(calls[0].text).toBe(
      'INSERT INTO "post" ("title") VALUES ($1) RETURNING "title"',
    );
  });
});

describe('createManyRows', () => {
  it('пустой вход не ходит в БД', async () => {
    const { fn, calls } = fakeQueryFn([]);

    expect(await createManyRows(fn, 'post', [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('склеивает строки в один multi-VALUES и склеивает результат по порядку', async () => {
    const { fn, calls } = fakeQueryFn([
      [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
    ]);

    const rows = await createManyRows(fn, 'post', [
      { title: 'a' },
      { title: 'b' },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe(
      'INSERT INTO "post" ("title") VALUES ($1), ($2) RETURNING *',
    );
    expect(calls[0].values).toEqual(['a', 'b']);
    expect(rows).toEqual([
      { id: 1, title: 'a' },
      { id: 2, title: 'b' },
    ]);
  });

  it('режет на батчи по лимиту параметров PostgreSQL', async () => {
    const { fn, calls } = fakeQueryFn([[], []]);
    // Кастомный builder не строит SQL — интересует только число вызовов.
    const stubBuilder = () => ({ text: 'INSERT', values: [] });
    const row = { title: 't', views: 0 };
    const rowCount = maxBatchRows(2) + 1; // по 2 колонки на ряд

    await createManyRows(
      fn,
      'post',
      Array.from({ length: rowCount }, () => row),
      stubBuilder,
    );

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.text)).toEqual(['INSERT', 'INSERT']);
  });

  it('returning доходит до builder-а', async () => {
    const { fn } = fakeQueryFn([[]]);
    const seen: unknown[] = [];
    const spyBuilder: ManyRowsSqlBuilder = (_c, _r, renderReturning) => {
      seen.push(renderReturning);
      return { text: 'INSERT', values: [] };
    };
    const renderReturning = () => '"title"';

    await createManyRows(
      fn,
      'post',
      [{ title: 'a' }],
      spyBuilder,
      renderReturning,
    );

    expect(seen).toEqual([renderReturning]);
  });

  it('кастомный builder определяет ON CONFLICT', async () => {
    const { fn, calls } = fakeQueryFn([[{ id: 1, title: 'a' }]]);

    const rows = await createManyRows(
      fn,
      'post',
      [{ title: 'a', slug: 's' }],
      (c, r, returning) =>
        buildUpsertManySql(c, r, ['slug'], false, null, returning),
    );

    expect(calls[0].text).toBe(
      'INSERT INTO "post" ("title", "slug") VALUES ($1, $2) ' +
        'ON CONFLICT ("slug") DO UPDATE SET "title" = EXCLUDED."title" RETURNING *',
    );
    expect(rows).toEqual([{ id: 1, title: 'a' }]);
  });

  it('RETURNING из SelectItem[] рендерится в batch-пути createMany', async () => {
    const { fn, calls } = fakeQueryFn([[{ id: 1 }]]);
    const gen = new TestGenerator();
    // Реальный рендер проекции — тот же, что у UPDATE/DELETE/UPSERT.
    const renderReturning = (values: unknown[], pi: ParamState) =>
      gen.renderReturningClause(
        [{ kind: 'selectable', tableAlias: 'p', fieldName: 'id' }],
        values,
        pi,
      );

    await createManyRows(
      fn,
      'post',
      [{ title: 'a' }],
      (c, r, rr) => buildInsertManySql(c, r, rr),
      renderReturning,
    );

    // У INSERT нет FROM-алиаса — колонка RETURNING не квалифицируется.
    expect(calls[0].text).toBe(
      'INSERT INTO "post" ("title") VALUES ($1) RETURNING "id" AS "id"',
    );
    expect(calls[0].values).toEqual(['a']);
  });

  it('параметр в RETURNING продолжает нумерацию после VALUES', async () => {
    const { fn, calls } = fakeQueryFn([[{}]]);
    const gen = new TestGenerator();
    const renderReturning = (values: unknown[], pi: ParamState) =>
      gen.renderReturningClause(
        [
          {
            kind: 'sql-item',
            alias: 'norm',
            text: 'coalesce($1, 0)',
            values: [5],
            slotOrder: [],
          },
        ],
        values,
        pi,
      );

    await createManyRows(
      fn,
      'post',
      [{ title: 'a' }, { title: 'b' }],
      (c, r, rr) => buildInsertManySql(c, r, rr),
      renderReturning,
    );

    // $1,$2 — значения VALUES; $3 — параметр из RETURNING (не $1).
    expect(calls[0].text).toContain('coalesce($3, 0)');
    expect(calls[0].values).toEqual(['a', 'b', 5]);
  });
});
