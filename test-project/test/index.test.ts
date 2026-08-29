import { describe, it, expect } from 'vitest';
import { Model } from '@karkardmitry/kadmium-core';
import { makeHarness, MODELS } from './helpers';

describe('core init + config (no DB)', () => {
  it('registers all models and compiles IR', async () => {
    const { app } = await makeHarness();
    expect(app.modelCount).toBe(3);
    expect(app.allIrs.map((ir) => ir.name).sort()).toEqual([
      'Comment',
      'Post',
      'User',
    ]);
    // registry resolve
    expect(Model.resolve('User')).toBeDefined();
    expect(Model.resolve('Nope')).toBeUndefined();
  });

  it('compiles correct IR types (bool/ref/pk/collection)', async () => {
    const { irs } = await makeHarness();
    const user = irs.get('User')!;
    const post = irs.get('Post')!;

    expect(user.collection).toBe('user');
    expect(post.collection).toBe('post');

    // PK: isPrimary + bigint
    expect(user.fields.id.isPrimary).toBe(true);
    expect(user.fields.id.type).toBe('bigint');

    // bool -> boolean (NOT string)
    expect(user.fields.active.type).toBe('boolean');

    // ref -> ref, target resolved
    expect(post.fields.author.type).toBe('ref');
    expect(post.fields.author.ref).toBe('User');

    // number -> int
    expect(user.fields.age.type).toBe('int');
  });

  it('loads config from kadmium.config.ts via AppCore.init', async () => {
    const { AppCore } = await import('@karkardmitry/kadmium-core');
    const app = await AppCore.init();
    expect(app.modelCount).toBe(3);
    const names = app.allIrs.map((ir) => ir.name).sort();
    expect(names).toEqual(['Comment', 'Post', 'User']);
  });
});
