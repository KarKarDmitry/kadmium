import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel, Post as PostModel } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed } from '../fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('transactions: commit and rollback', () => {
  it('commits work done inside transaction', async () => {
    await h.orm.transaction(async (tx) => {
      await tx.single(UserModel).create({
        name: 'TxnUser',
        email: 'txn@test.com',
        age: 50,
        active: true,
        registeredAt: new Date(),
      });
    });
    const found = await h.orm
      .single(UserModel)
      .where((u) => u.email.eq('txn@test.com'))
      .first()
      .go();
    expect(found?.name).toBe('TxnUser');
  });

  it('rolls back on error', async () => {
    await expect(
      h.orm.transaction(async (tx) => {
        await tx.single(UserModel).create({
          name: 'RollbackUser',
          email: 'rb@test.com',
          age: 51,
          active: true,
          registeredAt: new Date(),
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const found = await h.orm
      .single(UserModel)
      .where((u) => u.email.eq('rb@test.com'))
      .first()
      .go();
    expect(found).toBeUndefined();
  });

  it('does not leak the pooled connection after error', async () => {
    await expect(
      h.orm.transaction(async (tx) => {
        await tx.single(PostModel).select().go();
        throw new Error('boom2');
      }),
    ).rejects.toThrow('boom2');
    // Пул не должен быть разрушен — обычный запрос работает
    const count = await h.orm.single(PostModel).count().go();
    expect(typeof count).toBe('number');
  });
});
