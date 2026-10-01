import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel, Post as PostModel } from '../../../src/models';
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

describe('transactions: heavy edges', () => {
  it('nested transactions are rejected', async () => {
    await expect(
      h.orm.transaction(async (tx) => {
        await tx.transaction(async () => {
          // не должно дойти
        });
      }),
    ).rejects.toThrow(/Nested transactions are not supported/);
  });

  it('uncommitted insert is invisible to the main orm', async () => {
    let committed = false;
    await h.orm.transaction(async (tx) => {
      await tx
        .insert(UserModel)
        .values({
          name: 'Ghost',
          email: 'ghost@test.com',
          age: 1,
          active: true,
        })
        .go();
      // read-your-writes внутри tx видны
      const [inside] = await tx
        .select(UserModel)
        .where((u) => u.email.eq('ghost@test.com'))
        .fields((u) => [u.name])
        .go();
      expect(inside.name).toBe('Ghost');
      // снаружи (другое соединение) — нет
      const outside = await h.orm
        .select(UserModel)
        .where((u) => u.email.eq('ghost@test.com'))
        .first()
        .go();
      expect(outside).toBeUndefined();
      committed = true;
    });
    expect(committed).toBe(true);
    // после коммита видно всем
    const after = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('ghost@test.com'))
      .first()
      .go();
    expect(after).toBeDefined();
  });

  it('DB error inside tx surfaces the original error (not masked)', async () => {
    // email уникален — insert с дубликатом уронит PG (23505)
    await expect(
      h.orm.transaction(async (tx) => {
        await tx
          .insert(UserModel)
          .values({
            name: 'Dup',
            email: 'alice@test.com',
            age: 5,
            active: true,
          })
          .go();
      }),
    ).rejects.toMatchObject({ code: '23505' });
    // дубликат не остался
    const found = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Dup'))
      .first()
      .go();
    expect(found).toBeUndefined();
  });

  it('multi + include queries work inside a transaction', async () => {
    await h.orm.transaction(async (tx) => {
      const rows = await tx
        .query({ u: UserModel, p: PostModel })
        .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
        .include({ p: { comments: true } })
        .where((t) => t.u.name.eq('Alice'))
        .fields((t) => [t.p.title])
        .go();
      expect(rows.length).toBe(2);
      const withComments = rows.find((r) => r.p.comments.length > 0);
      expect(withComments).toBeTruthy();
    });
  });

  it('sequential transactions keep the pool healthy', async () => {
    for (let i = 0; i < 3; i++) {
      await h.orm.transaction(async (tx) => {
        await tx.select(PostModel).go();
      });
    }
    const count = await h.orm.select(PostModel).count().go();
    expect(typeof count).toBe('number');
  });

  it('rollback undoes writes made before the error', async () => {
    await expect(
      h.orm.transaction(async (tx) => {
        await tx
          .insert(UserModel)
          .values({
            name: 'Partial',
            email: 'partial@test.com',
            age: 7,
            active: true,
          })
          .go();
        throw new Error('abort after insert');
      }),
    ).rejects.toThrow('abort after insert');
    const found = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('partial@test.com'))
      .first()
      .go();
    expect(found).toBeUndefined();
  });
});
