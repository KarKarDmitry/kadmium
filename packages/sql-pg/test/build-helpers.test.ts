import { describe, it, expect } from 'vitest';
import { PgAdapter, buildInsertManySql, buildUpsertManySql, unionKeys } from '../src/index';

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

describe('DML column-name validation (S10)', () => {
  const adapter = new PgAdapter({ host: 'localhost' });

  it('rejects a malicious column name in create', async () => {
    await expect(
      adapter.create('users', { 'name"; DROP TABLE users; --': 'x' }),
    ).rejects.toThrow(/Invalid SQL identifier/);
  });

  it('rejects a malicious column name in createMany (insert)', async () => {
    await expect(
      adapter.createMany('users', [
        { 'name"; DROP TABLE users; --': 'x' },
      ]),
    ).rejects.toThrow(/Invalid SQL identifier/);
  });

  it('rejects a malicious column name in createMany (upsert)', async () => {
    await expect(
      adapter.createMany(
        'users',
        [{ 'name"; DROP TABLE users; --': 'x' }],
        { conflictTarget: ['name'] },
      ),
    ).rejects.toThrow(/Invalid SQL identifier/);
  });
});

describe('unionKeys (C14)', () => {
  it('returns union of all row keys', () => {
    expect(
      unionKeys([
        { name: 'Alice', email: 'a@b.com' },
        { name: 'Bob', bio: 'hello' },
      ]),
    ).toEqual(expect.arrayContaining(['name', 'email', 'bio']));
  });

  it('strips id from keys', () => {
    expect(
      unionKeys([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]),
    ).toEqual(['name']);
  });

  it('returns empty array for empty input', () => {
    expect(unionKeys([])).toEqual([]);
  });

  it('single row returns its keys minus id', () => {
    expect(unionKeys([{ id: 1, name: 'Alice', email: 'a@b.com' }])).toEqual(
      expect.arrayContaining(['name', 'email']),
    );
  });
});

describe('buildInsertManySql — heterogeneous rows (C14)', () => {
  it('uses union of keys across rows', () => {
    const { text, values } = buildInsertManySql('users', [
      { name: 'Alice', email: 'a@b.com' },
      { name: 'Bob', bio: 'hello' },
    ]);
    // Columns should include all 3: name, email, bio
    expect(text).toContain('"name"');
    expect(text).toContain('"email"');
    expect(text).toContain('"bio"');
    // 3 columns × 2 rows = 6 values
    expect(values).toHaveLength(6);
    // Row 1: Alice, a@b.com, undefined (missing bio)
    expect(values[0]).toBe('Alice');
    expect(values[1]).toBe('a@b.com');
    expect(values[2]).toBeUndefined();
    // Row 2: Bob, undefined (missing email), hello
    expect(values[3]).toBe('Bob');
    expect(values[4]).toBeUndefined();
    expect(values[5]).toBe('hello');
  });

  it('strips id from columns', () => {
    const { text } = buildInsertManySql('users', [
      { id: 999, name: 'Alice', email: 'a@b.com' },
    ]);
    expect(text).not.toContain('"id"');
    expect(text).toContain('"name"');
    expect(text).toContain('"email"');
  });

  it('homogeneous rows still work', () => {
    const { text, values } = buildInsertManySql('users', [
      { name: 'Alice', email: 'a@b.com' },
      { name: 'Bob', email: 'b@b.com' },
    ]);
    expect(text).toContain('"name"');
    expect(text).toContain('"email"');
    expect(values).toEqual(['Alice', 'a@b.com', 'Bob', 'b@b.com']);
  });
});

describe('buildUpsertManySql — heterogeneous rows (C14)', () => {
  it('uses union of keys across rows', () => {
    const { text, values } = buildUpsertManySql(
      'users',
      [
        { name: 'Alice', email: 'a@b.com' },
        { name: 'Bob', bio: 'hello' },
      ],
      ['name'],
      false,
    );
    expect(text).toContain('"name"');
    expect(text).toContain('"email"');
    expect(text).toContain('"bio"');
    expect(values).toHaveLength(6);
  });

  it('strips id from columns', () => {
    const { text } = buildUpsertManySql(
      'users',
      [{ id: 1, name: 'Alice' }],
      ['name'],
      false,
    );
    expect(text).not.toContain('"id"');
  });
});