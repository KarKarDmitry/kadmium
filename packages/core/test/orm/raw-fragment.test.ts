import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppCore } from '../../src/core/app-core';
import { OrmManager } from '../../src/orm/orm';
import { sql } from '../../src/orm/sql-fragment';
import { slot } from '../../src/orm/slot';
import { Model } from '../../src/model/index';
import f from '../../src/model/fields';
import { makeMockAdapter } from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

class User extends Model {
  id = f.pk;
  name = f.string;
  tenantId = f.number;
  active = f.bool;

  ['~shape']!: { id: number; name: string; tenantId: number; active: boolean };
  ['~rel']!: Record<string, unknown>;
  ['~relInfo']!: Record<string, unknown>;
}

function makeOrm(app: AppCore, adapter: ReturnType<typeof makeMockAdapter>) {
  return new OrmManager(app, adapter as unknown as SqlAdapter);
}

describe('orm.raw — форма «фрагмент целиком»', () => {
  let app: AppCore;
  let adapter: ReturnType<typeof makeMockAdapter>;
  let orm: OrmManager;

  beforeEach(() => {
    Model.clear();
    app = new AppCore();
    app.register([User]);
    adapter = makeMockAdapter();
    orm = makeOrm(app, adapter);
  });

  afterEach(() => Model.clear());

  it('рендерит фрагмент без слотов и идёт в adapter.raw', async () => {
    adapter.raw.mockResolvedValue([{ id: 1 }]);
    const rows = await orm.raw(sql<{ id: number }>`SELECT id FROM "user"`);
    expect(rows).toEqual([{ id: 1 }]);
    expect(adapter.raw).toHaveBeenCalledWith('SELECT id FROM "user"', []);
  });

  it('инлайнит field-идентификатор в текст', async () => {
    const field = { getIdentifierForSql: () => '"u"."id"' };
    await orm.raw(sql<{ id: number }>`SELECT ${field} FROM "user"`);
    expect(adapter.raw).toHaveBeenCalledWith('SELECT "u"."id" FROM "user"', []);
  });

  it('незаполненный слот → throw с именем', () => {
    expect(() =>
      orm.raw(sql`SELECT * FROM "user" WHERE tenant_id = ${slot('tenantId')}`),
    ).toThrow(/Unfilled slot\(s\): tenantId\. Use \.fill\(\{\.\.\.\}\)\./);
    expect(adapter.raw).not.toHaveBeenCalled();
  });

  it('типизируется через sql<T>: orm.raw(sql<Row>) → Promise<Row[]>', async () => {
    const typed = sql<{ id: number; name: string }>`SELECT * FROM "user"`;
    const rows = await orm.raw(typed);
    // @ts-expect-error — TResult инферируется из sql<T>
    const bad: Promise<{ nope: string }[]> = orm.raw(typed);
    void bad;
    expect(rows).toEqual([]);
  });
});

describe('orm.raw — форма «фрагмент со слотами через .fill()»', () => {
  let app: AppCore;
  let adapter: ReturnType<typeof makeMockAdapter>;
  let orm: OrmManager;

  beforeEach(() => {
    Model.clear();
    app = new AppCore();
    app.register([User]);
    adapter = makeMockAdapter();
    orm = makeOrm(app, adapter);
  });

  afterEach(() => Model.clear());

  it('заменяет маркеры значений на params', async () => {
    adapter.raw.mockResolvedValue([{ id: 7 }]);
    const filled =
      sql`SELECT * FROM "user" WHERE tenant_id = ${slot('v')}`.fill({ v: 5 });
    const rows = await orm.raw(filled);
    expect(rows).toEqual([{ id: 7 }]);
    expect(adapter.raw).toHaveBeenCalledWith(
      'SELECT * FROM "user" WHERE tenant_id = $1',
      [5],
    );
  });

  it('валидирует missing/extra ключи fill как fillCompiled', () => {
    expect(() => sql`WHERE x = ${slot('a')}`.fill({})).toThrow(
      /Missing slot value\(s\): a/,
    );
    expect(() => sql`WHERE x = 1`.fill({ ghost: 1 } as never)).toThrow(
      /Unknown slot key\(s\): ghost/,
    );
  });

  it('типизируется явным generic для формы .fill()', async () => {
    const rows = await orm.raw<{ id: number }>(sql`SELECT id`.fill({}));
    expect(rows).toEqual([]);
  });
});

describe('orm.raw — форма «text + params» и регресс', () => {
  let app: AppCore;
  let adapter: ReturnType<typeof makeMockAdapter>;
  let orm: OrmManager;

  beforeEach(() => {
    Model.clear();
    app = new AppCore();
    app.register([User]);
    adapter = makeMockAdapter();
    orm = makeOrm(app, adapter);
  });

  afterEach(() => Model.clear());

  it('работает как раньше: (sql, params)', async () => {
    adapter.raw.mockResolvedValue([{ x: 1 }]);
    const rows = await orm.raw('SELECT $1', [1]);
    expect(rows).toEqual([{ x: 1 }]);
    expect(adapter.raw).toHaveBeenCalledWith('SELECT $1', [1]);
  });

  it('отличает FilledCompiled от CompiledQuery (по ключу params)', () => {
    // CompiledQuery (text/values/slotOrder/без params) — не фрагмент и не filled
    const fake = { text: 'SELECT 1', values: ['x'], slotOrder: [] } as never;
    expect(() => orm.raw(fake)).toThrow(/Invalid argument to raw\(\)/);
  });

  it('без адаптера → throw', () => {
    const appNo = new AppCore();
    appNo.register([User]);
    const noAdapter = new OrmManager(appNo);
    expect(() => noAdapter.raw('SELECT 1')).toThrow(
      /No SQL adapter configured/,
    );
    expect(() => noAdapter.raw(sql`SELECT 1`)).toThrow(
      /No SQL adapter configured/,
    );
  });
});
