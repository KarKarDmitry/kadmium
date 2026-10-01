import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed } from '../../fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('returning: insert / insertMany projection', () => {
  it('insert().returning() returns only selected fields', async () => {
    const row = await h.orm
      .insert(UserModel)
      .values({ name: 'Rita', email: 'rita@x.io' })
      .returning((u) => [u.id, u.name])
      .go();
    expect(row.id).toBeDefined();
    expect(row.name).toBe('Rita');
    expect('email' in row).toBe(false);
  });

  it('insert().returning() with alias uses alias as key', async () => {
    const row = await h.orm
      .insert(UserModel)
      .values({ name: 'Rune', email: 'rune@x.io' })
      .returning((u) => [u.name.as('who')])
      .go();
    expect(row).toEqual({ who: 'Rune' });
  });

  it('insert().returning() renders projection into RETURNING clause', () => {
    const sql = h.orm
      .insert(UserModel)
      .values({ name: 'Sql', email: 'sql@x.io' })
      .returning((u) => [u.id, u.name])
      .sql();
    const returning = sql.slice(sql.indexOf('RETURNING'));
    expect(returning).toContain('"id"');
    expect(returning).toContain('"name"');
    expect(returning).not.toContain('"email"');
  });

  it('insert().go() without returning returns full row (regression)', async () => {
    const row = await h.orm
      .insert(UserModel)
      .values({ name: 'Full', email: 'full@x.io' })
      .go();
    expect(row.name).toBe('Full');
    expect('email' in row).toBe(true);
  });

  it('insertMany().returning() projects every inserted row', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'M1', email: 'm1@x.io' },
        { name: 'M2', email: 'm2@x.io' },
      ])
      .returning((u) => [u.name])
      .go();
    expect(rows).toEqual([{ name: 'M1' }, { name: 'M2' }]);
  });

  it('insertMany().returning() with onConflict projects upserted rows', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([{ name: 'Alice', email: 'alice@new.io' }])
      .onConflict((u) => [u.email])
      .returning((u) => [u.name, u.email])
      .go();
    expect(rows).toEqual([{ name: 'Alice', email: 'alice@new.io' }]);
  });

  it('insertMany().go() without returning returns full rows (regression)', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([{ name: 'W1', email: 'w1@x.io' }])
      .go();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('W1');
    expect('email' in rows[0]).toBe(true);
  });
});
