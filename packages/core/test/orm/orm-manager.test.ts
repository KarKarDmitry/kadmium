import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppCore } from '../../src/core/app-core';
import { OrmManager } from '../../src/orm/orm';
import { Model } from '../../src/model/index';
import { makeMockAdapter } from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

class User extends Model {
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