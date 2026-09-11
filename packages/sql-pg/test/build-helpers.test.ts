import { describe, it, expect } from 'vitest';
import { PgAdapter } from '../src/index';

describe('DML collection-name validation (S7)', () => {
  // Pool создаётся лениво — запросы не выполняются: assert кидает до query.
  const adapter = new PgAdapter({ host: 'localhost' });

  it('rejects a malicious collection name in create', async () => {
    await expect(
      adapter.create('users"; DROP TABLE users; --', { name: 'x' }),
    ).rejects.toThrow(/Invalid SQL identifier/);
  });

  it('rejects a malicious collection name in createMany (insert)', async () => {
    await expect(
      adapter.createMany('users"; DROP TABLE users; --', [{ name: 'x' }]),
    ).rejects.toThrow(/Invalid SQL identifier/);
  });

  it('rejects a malicious collection name in createMany (upsert)', async () => {
    await expect(
      adapter.createMany('users"; DROP TABLE users; --', [{ name: 'x' }], {
        conflictTarget: ['name'],
      }),
    ).rejects.toThrow(/Invalid SQL identifier/);
  });
});