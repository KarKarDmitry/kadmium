import { describe, it, expect } from 'vitest';
import { generateModel } from '../../src/codegen/generate-model';
import type { ModelIR } from '../../src/ir/index';

function makeIr(overrides: Partial<ModelIR> & { name: string }): ModelIR {
  return {
    collection: overrides.name.toLowerCase(),
    fields: {},
    ...overrides,
  };
}

describe('generateModel', () => {
  it('minimal model — ~shape only, no ~rel, no imports', () => {
    const ir = makeIr({
      name: 'User',
      fields: {
        name: { type: 'string', tsType: 'string', alias: 'name', nullable: false, unique: false, index: false },
      },
    });
    const out = generateModel(ir, 'models/user', [ir]);
    expect(out).toContain("declare module 'models/user'");
    expect(out).toContain("['~shape']: {");
    expect(out).toContain('name: string;');
    expect(out).not.toContain('~rel');
    expect(out).not.toContain('import ');
  });

  it('nullable field → | undefined', () => {
    const ir = makeIr({
      name: 'User',
      fields: {
        name: { type: 'string', tsType: 'string', alias: 'name', nullable: true, unique: false, index: false },
      },
    });
    const out = generateModel(ir, 'models/user', [ir]);
    expect(out).toContain('name: string | undefined;');
  });

  it('forward ref → number in ~shape, Target in ~rel', () => {
    const userIr = makeIr({ name: 'User', fields: {} });
    const postIr = makeIr({
      name: 'Post',
      fields: {
        authorId: { type: 'ref', tsType: 'User', alias: 'authorId', nullable: false, unique: false, index: false, ref: 'User', relation: 'many-to-one' },
      },
    });
    const out = generateModel(postIr, 'models/post', [userIr, postIr]);
    expect(out).toContain('authorId: number;');
    expect(out).toContain("['~rel']");
    expect(out).toContain('authorId: User;');
  });

  it('inverse ref (one-to-many) excluded from ~shape, Target[] in ~rel', () => {
    const userIr = makeIr({
      name: 'User',
      fields: {
        posts: { type: 'ref', tsType: 'Post', alias: 'posts', nullable: false, unique: false, index: false, ref: 'Post', relation: 'one-to-many', sourceModel: 'Post' },
      },
    });
    const out = generateModel(userIr, 'models/user', [userIr]);
    expect(out).not.toContain('posts: number;');
    expect(out).toContain('posts: Post[];');
  });

  it('cross-model import generated', () => {
    const userIr = makeIr({ name: 'User', fields: {} });
    const postIr = makeIr({
      name: 'Post',
      fields: {
        authorId: { type: 'ref', tsType: 'User', alias: 'authorId', nullable: false, unique: false, index: false, ref: 'User', relation: 'many-to-one' },
      },
    });
    const out = generateModel(postIr, 'models/post', [userIr, postIr]);
    expect(out).toContain("import { User } from 'models/user';");
  });

  it('self-referential model → no import', () => {
    const ir = makeIr({
      name: 'User',
      fields: {
        parentId: { type: 'ref', tsType: 'User', alias: 'parentId', nullable: true, unique: false, index: false, ref: 'User', relation: 'many-to-one' },
      },
    });
    const out = generateModel(ir, 'models/user', [ir]);
    expect(out).not.toContain('import ');
  });

  it('modulePath with no / → import path is just name', () => {
    const userIr = makeIr({ name: 'User', fields: {} });
    const postIr = makeIr({
      name: 'Post',
      fields: {
        authorId: { type: 'ref', tsType: 'User', alias: 'authorId', nullable: false, unique: false, index: false, ref: 'User', relation: 'many-to-one' },
      },
    });
    const out = generateModel(postIr, 'post', [userIr, postIr]);
    expect(out).toContain("import { User } from 'user';");
  });

  it('allIrs missing referenced model → import skipped', () => {
    const postIr = makeIr({
      name: 'Post',
      fields: {
        authorId: { type: 'ref', tsType: 'User', alias: 'authorId', nullable: false, unique: false, index: false, ref: 'User', relation: 'many-to-one' },
      },
    });
    const out = generateModel(postIr, 'models/post', [postIr]);
    expect(out).not.toContain('import ');
  });

  it('empty fields → ~shape: {}', () => {
    const ir = makeIr({ name: 'Empty', fields: {} });
    const out = generateModel(ir, 'models/empty', [ir]);
    expect(out).toContain("['~shape']: {");
    expect(out).toContain('};');
    expect(out).not.toContain('~rel');
  });

  it('nullable forward ref → number | undefined in ~shape', () => {
    const userIr = makeIr({ name: 'User', fields: {} });
    const postIr = makeIr({
      name: 'Post',
      fields: {
        authorId: { type: 'ref', tsType: 'User', alias: 'authorId', nullable: true, unique: false, index: false, ref: 'User', relation: 'many-to-one' },
      },
    });
    const out = generateModel(postIr, 'models/post', [userIr, postIr]);
    expect(out).toContain('authorId: number | undefined;');
  });

  it('non-nullable forward ref → number in ~shape', () => {
    const userIr = makeIr({ name: 'User', fields: {} });
    const postIr = makeIr({
      name: 'Post',
      fields: {
        authorId: { type: 'ref', tsType: 'User', alias: 'authorId', nullable: false, unique: false, index: false, ref: 'User', relation: 'many-to-one' },
      },
    });
    const out = generateModel(postIr, 'models/post', [userIr, postIr]);
    expect(out).toContain('authorId: number;');
  });

  it('output contains export {}', () => {
    const ir = makeIr({ name: 'User', fields: {} });
    const out = generateModel(ir, 'models/user', [ir]);
    expect(out).toContain('export {};');
  });

  it('output starts with auto-generated header', () => {
    const ir = makeIr({ name: 'User', fields: {} });
    const out = generateModel(ir, 'models/user', [ir]);
    expect(out).toMatch(/^\/\/ Auto-generated\. Do not edit\.\n/);
  });
});
