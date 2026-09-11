import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppCore } from '../../src/core/app-core';
import { OrmManager } from '../../src/orm/orm';
import { Model } from '../../src/model/index';
import type { ModelIR } from '../../src/ir/index';
import f from '../../src/model/fields';
import { makeMockAdapter } from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

class User extends Model {
  name = f.string;
  ['~shape']!: Record<string, unknown>;
  ['~rel']!: Record<string, unknown>;
  ['~relInfo']!: Record<string, unknown>;
}

describe('OrmManager — adapter routing', () => {
  let app: AppCore;
  let globalAdapter: ReturnType<typeof makeMockAdapter>;
  let overrideAdapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(() => {
    Model.clear();
    app = new AppCore();
    app.register([User]);
    globalAdapter = makeMockAdapter();
    overrideAdapter = makeMockAdapter();
    app.sqlAdapter = globalAdapter as unknown as SqlAdapter;
  });

  afterEach(() => Model.clear());

  it('uses the appCore adapter by default', async () => {
    const orm = new OrmManager(app);
    await orm.single(User).go();

    expect(globalAdapter.execute).toHaveBeenCalled();
    expect(overrideAdapter.execute).not.toHaveBeenCalled();
  });

  it('withAdapter routes queries to the override adapter', async () => {
    const orm = new OrmManager(app);
    await orm.withAdapter(overrideAdapter as unknown as SqlAdapter).single(User).go();

    expect(overrideAdapter.execute).toHaveBeenCalled();
    expect(globalAdapter.execute).not.toHaveBeenCalled();
  });

  it('withAdapter returns a distinct manager; original keeps the global adapter', async () => {
    const orm = new OrmManager(app);
    const override = orm.withAdapter(overrideAdapter as unknown as SqlAdapter);
    expect(override).not.toBe(orm);

    await override.single(User).go();
    await orm.single(User).go();

    expect(overrideAdapter.execute).toHaveBeenCalledTimes(1);
    expect(globalAdapter.execute).toHaveBeenCalledTimes(1);
  });
});

describe('OrmManager — shared IR cache (A20)', () => {
  let app: AppCore;
  let orm: OrmManager;

  beforeEach(() => {
    Model.clear();
    app = new AppCore();
    app.register([User]);
    app.sqlAdapter = makeMockAdapter() as unknown as SqlAdapter;
    orm = new OrmManager(app);
  });

  afterEach(() => Model.clear());

  interface ManagerInternals {
    _irCache: Map<string, ModelIR | undefined>;
    _irLookup: (name: string) => ModelIR | undefined;
  }

  it('single() and _irLookup() share a single cached ModelIR instance', () => {
    orm.single(User);

    const internals = orm as unknown as ManagerInternals;
    const viaCache = internals._irCache.get('User');
    const viaLookup = internals._irLookup('User');

    expect(viaLookup).toBe(viaCache);
    expect(viaLookup).toBe(app.ir('User'));
    expect(internals._irCache.has('User')).toBe(true);
  });

  it('_irLookup() writes its fallback-compiled IR into the shared cache', () => {
    class Post extends Model {
      title = f.string;
      ['~shape']!: Record<string, unknown>;
      ['~rel']!: Record<string, unknown>;
      ['~relInfo']!: Record<string, unknown>;
    }
    Model.register(Post);

    const internals = orm as unknown as ManagerInternals;
    const viaLookup = internals._irLookup('Post');
    const viaCache = internals._irCache.get('Post');

    expect(viaLookup).toBeDefined();
    expect(internals._irCache.has('Post')).toBe(true);
    expect(viaCache).toBe(viaLookup);
  });
});

describe('OrmManager — batch upsert routing', () => {
  let app: AppCore;
  let adapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(() => {
    Model.clear();
    app = new AppCore();
    app.register([User]);
    adapter = makeMockAdapter();
    app.sqlAdapter = adapter as unknown as SqlAdapter;
  });

  afterEach(() => Model.clear());

  it('createMany().onConflict().go() issues ONE createMany, no per-row execute', async () => {
    const orm = new OrmManager(app);
    adapter.createMany.mockResolvedValue([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);

    const rows = await orm
      .single(User)
      .createMany([{ name: 'Alice' }, { name: 'Bob' }])
      .onConflict((t) => [t.email])
      .go();

    expect(adapter.createMany).toHaveBeenCalledTimes(1);
    expect(adapter.createMany).toHaveBeenCalledWith(
      'user',
      [{ name: 'Alice' }, { name: 'Bob' }],
      expect.objectContaining({ conflictTarget: ['email'], doNothing: false }),
    );
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('Alice');
  });

  it('doNothing forwards doNothing: true', async () => {
    const orm = new OrmManager(app);
    adapter.createMany.mockResolvedValue([]);

    await orm
      .single(User)
      .createMany([{ name: 'X' }])
      .onConflict((t) => [t.email])
      .doNothing()
      .go();

    expect(adapter.createMany).toHaveBeenCalledWith(
      'user',
      [{ name: 'X' }],
      expect.objectContaining({ conflictTarget: ['email'], doNothing: true }),
    );
    expect(adapter.execute).not.toHaveBeenCalled();
  });
});