import { describe, it, expect, vi, afterEach } from 'vitest';
import type { DbColumn, SqlAdapter, TransactionalAdapter } from '@karkardmitry/kadmium-sql-types';
import { applyDiff, applyDiffTransactional } from '../../src/diff/apply';
import {
  addEmailIndexOp,
  addFkOp,
  addLegacyIndexOp,
  addTitleColumnOp,
  alterAuthorTypeOp,
  alterNameNullableOp,
  createUsersOp,
  diff,
  dropCategoryFkOp,
  dropLegacyColumnOp,
  dropLegacyIndexOp,
  dropPostsOp,
  MockDdl,
} from './fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

interface TxProbe {
  alias: SqlAdapter;
  state: { commits: number; rollbacks: number };
  ddl: MockDdl;
}

/** Minimal SqlAdapter whose beginTransaction wraps a MockDdl. */
function txAdapter(opts: {
  failOnApply?: (method: string) => boolean;
  failRollback?: boolean;
} = {}): TxProbe {
  const ddl = new MockDdl(opts.failOnApply);
  const state = { commits: 0, rollbacks: 0 };
  const tx = {
    ddl,
    async commit(): Promise<void> {
      state.commits++;
    },
    async rollback(): Promise<void> {
      state.rollbacks++;
      if (opts.failRollback) throw new Error('rollback boom');
    },
  } as unknown as TransactionalAdapter;
  const alias = {
    ddl,
    beginTransaction: () => Promise.resolve(tx),
  } as unknown as SqlAdapter;
  return { alias, state, ddl };
}

describe('applyDiff', () => {
  it('returns [] and touches nothing for an empty diff', async () => {
    const ddl = new MockDdl();
    const applied = await applyDiff(diff([]), ddl);
    expect(applied).toEqual([]);
    expect(ddl.calls).toEqual([]);
  });

  it('creates tables in phase 1 before indexes and FKs', async () => {
    const ddl = new MockDdl();
    const applied = await applyDiff(
      diff([addFkOp(), addEmailIndexOp(), createUsersOp()]),
      ddl,
    );

    expect(applied).toEqual([
      'CREATE TABLE users',
      'ADD FK fk_posts_author (posts → user)',
      'ADD INDEX idx_users_email on users',
    ]);

    const calls = ddl.calls.map((c) => c.method);
    expect(calls).toEqual(['createTable', 'addForeignKey', 'addIndex']);
  });

  it('strips inline UNIQUE from columns that get an index in phase 2', async () => {
    const ddl = new MockDdl();
    await applyDiff(diff([createUsersOp(), addEmailIndexOp()]), ddl);

    const [, columns] = ddl.calls.find((c) => c.method === 'createTable')
      ?.args as [string, DbColumn[]];
    expect(columns.find((c) => c.name === 'email')?.isUnique).toBe(false);
    expect(columns.find((c) => c.name === 'id')?.isUnique).toBe(true);
  });

  it('keeps inline UNIQUE when no matching index op exists', async () => {
    const ddl = new MockDdl();
    await applyDiff(diff([createUsersOp()]), ddl);

    const [, columns] = ddl.calls.find((c) => c.method === 'createTable')
      ?.args as [string, DbColumn[]];
    expect(columns.find((c) => c.name === 'email')?.isUnique).toBe(true);
  });

  it('routes every op type to the matching ddl method', async () => {
    const ddl = new MockDdl();
    const ops = [
      addTitleColumnOp(),
      dropLegacyColumnOp(),
      alterAuthorTypeOp(),
      alterNameNullableOp(),
      addLegacyIndexOp(),
      dropLegacyIndexOp(),
      addFkOp(),
      dropCategoryFkOp(),
    ];
    await applyDiff(diff(ops), ddl);

    const byName = new Map(ddl.calls.map((c) => [c.method, c.args]));
    expect(byName.get('addColumn')).toEqual(['posts', ops[0].column]);
    expect(byName.get('dropColumn')).toEqual(['posts', 'legacy']);
    expect(byName.get('alterType')).toEqual(['posts', 'author', 'integer']);
    expect(byName.get('alterNullable')).toEqual(['users', 'name', false]);
    expect(byName.get('addIndex')).toEqual([ops[4].index]);
    expect(byName.get('dropIndex')).toEqual(['idx_posts_legacy']);
    expect(byName.get('addForeignKey')).toEqual([ops[6].fk]);
    expect(byName.get('dropForeignKey')).toEqual(['fk_posts_category', 'posts']);
  });

  it('skips drop-table but still reports it as applied', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ddl = new MockDdl();
    const applied = await applyDiff(diff([dropPostsOp()]), ddl);

    expect(applied).toEqual(['DROP TABLE posts']);
    expect(ddl.calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping drop-table: posts'),
    );
  });
});

describe('applyDiffTransactional', () => {
  it('commits when every op succeeds', async () => {
    const { alias, state, ddl } = txAdapter();
    const applied = await applyDiffTransactional(
      diff([createUsersOp()]),
      alias,
    );

    expect(applied).toEqual(['CREATE TABLE users']);
    expect(state.commits).toBe(1);
    expect(state.rollbacks).toBe(0);
    expect(ddl.calls.map((c) => c.method)).toEqual(['createTable']);
  });

  it('rolls back and rethrows when an op fails mid-apply', async () => {
    const { alias, state } = txAdapter({
      failOnApply: (method) => method === 'addIndex',
    });

    await expect(
      applyDiffTransactional(diff([createUsersOp(), addEmailIndexOp()]), alias),
    ).rejects.toThrow('boom: addIndex');
    expect(state.commits).toBe(0);
    expect(state.rollbacks).toBe(1);
  });

  it('does not mask the original error when rollback itself fails', async () => {
    const { alias, state } = txAdapter({
      failOnApply: (method) => method === 'createTable',
      failRollback: true,
    });

    await expect(
      applyDiffTransactional(diff([createUsersOp(), addEmailIndexOp()]), alias),
    ).rejects.toThrow('boom: createTable');
    expect(state.commits).toBe(0);
    expect(state.rollbacks).toBe(1);
  });

  it('requires an adapter that can begin a transaction', async () => {
    const broken = {
      ddl: {},
    } as unknown as SqlAdapter;
    await expect(
      applyDiffTransactional(diff([createUsersOp()]), broken),
    ).rejects.toThrow();
  });
});