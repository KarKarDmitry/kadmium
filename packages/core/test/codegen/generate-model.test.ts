import { describe, it, expect } from 'vitest';
import { generateModel } from '../../src/codegen/generate-model';
import type { FieldIR, ModelIR } from '../../src/ir/index';

function makeIr(overrides: Partial<ModelIR> & { name: string }): ModelIR {
  return {
    collection: overrides.name.toLowerCase(),
    fields: {},
    ...overrides,
  };
}

describe('generateModel', () => {
  it('minimal model — ~shape, пустой ~rel, no imports', () => {
    const ir = makeIr({
      name: 'User',
      fields: {
        name: {
          type: 'string',
          tsType: 'string',
          alias: 'name',
          nullable: false,
          unique: false,
          index: false,
        },
      },
    });
    const out = generateModel(ir, 'models/user', [ir]);
    expect(out).toContain("declare module 'models/user'");
    expect(out).toContain("['~shape']: {");
    expect(out).toContain('name: string;');
    // `~rel`/`~relInfo` эмитятся всегда, пустыми: ORM требует их на модели, и без
    // нихrelation-less модель не проходит проверку типов после кодогенерации.
    expect(out).toContain("['~rel']: {");
    expect(out).toContain("['~relInfo']: {");
    expect(out).not.toContain('import ');
  });

  it('nullable field → | undefined', () => {
    const ir = makeIr({
      name: 'User',
      fields: {
        name: {
          type: 'string',
          tsType: 'string',
          alias: 'name',
          nullable: true,
          unique: false,
          index: false,
        },
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
        authorId: {
          type: 'ref',
          tsType: 'User',
          alias: 'authorId',
          nullable: false,
          unique: false,
          index: false,
          ref: 'User',
          relation: 'many-to-one',
        },
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
        posts: {
          type: 'ref',
          tsType: 'Post',
          alias: 'posts',
          nullable: false,
          unique: false,
          index: false,
          ref: 'Post',
          relation: 'one-to-many',
          sourceModel: 'Post',
        },
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
        authorId: {
          type: 'ref',
          tsType: 'User',
          alias: 'authorId',
          nullable: false,
          unique: false,
          index: false,
          ref: 'User',
          relation: 'many-to-one',
        },
      },
    });
    const out = generateModel(postIr, 'models/post', [userIr, postIr]);
    expect(out).toContain("import { User } from 'models/user';");
  });

  it('self-referential model → no import', () => {
    const ir = makeIr({
      name: 'User',
      fields: {
        parentId: {
          type: 'ref',
          tsType: 'User',
          alias: 'parentId',
          nullable: true,
          unique: false,
          index: false,
          ref: 'User',
          relation: 'many-to-one',
        },
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
        authorId: {
          type: 'ref',
          tsType: 'User',
          alias: 'authorId',
          nullable: false,
          unique: false,
          index: false,
          ref: 'User',
          relation: 'many-to-one',
        },
      },
    });
    const out = generateModel(postIr, 'post', [userIr, postIr]);
    expect(out).toContain("import { User } from 'user';");
  });

  it('allIrs missing referenced model → import skipped', () => {
    const postIr = makeIr({
      name: 'Post',
      fields: {
        authorId: {
          type: 'ref',
          tsType: 'User',
          alias: 'authorId',
          nullable: false,
          unique: false,
          index: false,
          ref: 'User',
          relation: 'many-to-one',
        },
      },
    });
    const out = generateModel(postIr, 'models/post', [postIr]);
    expect(out).not.toContain('import ');
  });

  it('empty fields → ~shape: {}, ~rel: {}', () => {
    const ir = makeIr({ name: 'Empty', fields: {} });
    const out = generateModel(ir, 'models/empty', [ir]);
    expect(out).toContain("['~shape']: {");
    expect(out).toContain('};');
    expect(out).toContain("['~rel']: {");
    expect(out).toContain("['~relInfo']: {");
  });

  it('nullable forward ref → number | undefined in ~shape', () => {
    const userIr = makeIr({ name: 'User', fields: {} });
    const postIr = makeIr({
      name: 'Post',
      fields: {
        authorId: {
          type: 'ref',
          tsType: 'User',
          alias: 'authorId',
          nullable: true,
          unique: false,
          index: false,
          ref: 'User',
          relation: 'many-to-one',
        },
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
        authorId: {
          type: 'ref',
          tsType: 'User',
          alias: 'authorId',
          nullable: false,
          unique: false,
          index: false,
          ref: 'User',
          relation: 'many-to-one',
        },
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

  it('relInfo kind for inverse one-to-one is one-to-one, not one-to-many', () => {
    const profileIr = makeIr({ name: 'Profile', fields: {} });
    const userIr = makeIr({
      name: 'User',
      fields: {
        profile: {
          type: 'ref',
          tsType: 'Profile',
          alias: 'profile',
          nullable: true,
          unique: false,
          index: false,
          ref: 'Profile',
          relation: 'one-to-one',
          sourceModel: 'Profile',
          inverse: 'profile',
          inverseRelation: 'one-to-one',
          foreignKey: 'user',
        },
      },
    });
    const out = generateModel(userIr, 'models/user', [userIr, profileIr]);
    expect(out).toContain("profile: { target: Profile; kind: 'one-to-one' };");
  });

  it('import path for a multiword target matches its sourceFile basename', () => {
    const accountIr = makeIr({
      name: 'UserAccount',
      fields: {},
      sourceFile: 'src/models/user-account',
    });
    const postIr = makeIr({
      name: 'Post',
      fields: {
        accounts: {
          type: 'ref',
          tsType: 'UserAccount',
          alias: 'accounts',
          nullable: false,
          unique: false,
          index: false,
          ref: 'UserAccount',
          relation: 'one-to-many',
          sourceModel: 'UserAccount',
        },
      },
    });
    const out = generateModel(postIr, '../src/models/post', [
      accountIr,
      postIr,
    ]);
    expect(out).toContain(
      "import { UserAccount } from '../src/models/user-account';",
    );
  });

  describe('~defaults — поля, которые заполняет БД', () => {
    function fieldWith(
      name: string,
      extra: Partial<FieldIR> = {},
    ): Record<string, FieldIR> {
      return {
        [name]: {
          type: 'string',
          tsType: 'string',
          alias: name,
          nullable: false,
          unique: false,
          index: false,
          ...extra,
        },
      };
    }

    it('поле с spec.default попадает в ~defaults', () => {
      const ir = makeIr({
        name: 'Post',
        fields: fieldWith('title', { nullable: true }),
      });
      (ir.fields.title as { spec: unknown }).spec = { default: 'untitled' };

      const out = generateModel(ir, 'models/post', [ir]);
      expect(out).toContain("['~defaults']: {");
      expect(out).toContain('title: string;');
    });

    it('autoincrement-PK попадает в ~defaults — values() не спросит id', () => {
      const ir = makeIr({
        name: 'User',
        fields: fieldWith('id', {
          type: 'bigint',
          tsType: 'number',
          isPrimary: true,
        }),
      });

      const out = generateModel(ir, 'models/user', [ir]);
      expect(out).toContain("['~defaults']: {");
      expect(out).toContain('id: number;');
    });

    it('uuid-PK без default в ~defaults НЕ попадает — id обязан прийти от клиента', () => {
      const ir = makeIr({
        name: 'UserAccount',
        fields: fieldWith('id', {
          type: 'uuid',
          tsType: 'string',
          isPrimary: true,
          spec: { db_type: 'uuid' },
        }),
      });

      const out = generateModel(ir, 'models/user-account', [ir]);
      expect(out).not.toContain('~defaults');
      expect(out).toContain('id: string;');
    });

    it('string-PK без default в ~defaults НЕ попадает', () => {
      const ir = makeIr({
        name: 'Account',
        fields: fieldWith('code', {
          type: 'string',
          tsType: 'string',
          isPrimary: true,
          spec: { db_type: 'string' },
        }),
      });

      expect(generateModel(ir, 'models/account', [ir])).not.toContain(
        '~defaults',
      );
    });

    it('NOT NULL без default в ~defaults НЕ попадает — это настоящее NOT NULL', () => {
      const ir = makeIr({ name: 'User', fields: fieldWith('email') });

      expect(generateModel(ir, 'models/user', [ir])).not.toContain('~defaults');
    });

    it('inverse ref (sourceModel) в ~defaults не попадает даже с default', () => {
      const ir = makeIr({
        name: 'Post',
        fields: fieldWith('comments', {
          type: 'ref',
          tsType: 'Comment',
          ref: 'Comment',
          relation: 'one-to-many',
          sourceModel: 'Post',
          spec: { default: 1 },
        }),
      });

      expect(generateModel(ir, 'models/post', [ir])).not.toContain('~defaults');
    });

    it('forward ref с default попадает в ~defaults типом number', () => {
      const userIr = makeIr({ name: 'User', fields: {} });
      const postIr = makeIr({
        name: 'Post',
        fields: fieldWith('author', {
          type: 'ref',
          tsType: 'User',
          ref: 'User',
          relation: 'many-to-one',
          spec: { default: 1 },
        }),
      });

      const out = generateModel(postIr, 'models/post', [userIr, postIr]);
      expect(out).toContain("['~defaults']: {");
      expect(out).toContain('author: number;');
    });
  });

  /**
   * `~pk` — имя свойства первичного ключа, по которому `findById` выводит
   * тип аргумента (`PkShape<M>`). Это КЛЮЧ модели, а не колонка: колонка
   * может быть переименована через `.alias()`, и `~pk` обязан остаться
   * тем, чем пользуется прокси.
   */
  describe('~pk', () => {
    /** Локальный хелпер: одноимённый в describe('~defaults') не виден отсюда. */
    function pkField(
      name: string,
      extra: Partial<FieldIR> = {},
    ): Record<string, FieldIR> {
      return {
        [name]: {
          type: 'string',
          tsType: 'string',
          alias: name,
          nullable: false,
          unique: false,
          index: false,
          ...extra,
        },
      };
    }

    it('эмитит имя свойства PK', () => {
      const ir = makeIr({
        name: 'Account',
        fields: pkField('uid', {
          type: 'bigint',
          tsType: 'number',
          isPrimary: true,
        }),
      });
      expect(generateModel(ir, 'models/account', [ir])).toContain(
        "['~pk']: 'uid';",
      );
    });

    it('именем остаётся ключ модели, а не alias колонки', () => {
      const ir = makeIr({
        name: 'Account',
        fields: pkField('uid', {
          type: 'uuid',
          tsType: 'string',
          alias: 'user_uid',
          isPrimary: true,
        }),
      });
      const out = generateModel(ir, 'models/account', [ir]);
      expect(out).toContain("['~pk']: 'uid';");
      expect(out).not.toContain("['~pk']: 'user_uid';");
    });

    it('дефолтный PK называется id', () => {
      const ir = makeIr({
        name: 'User',
        fields: pkField('id', { isPrimary: true }),
      });
      expect(generateModel(ir, 'models/user', [ir])).toContain(
        "['~pk']: 'id';",
      );
    });

    it('у модели без PK фантом не эмитится', () => {
      const ir = makeIr({
        name: 'Session',
        fields: pkField('token', {}),
      });
      expect(generateModel(ir, 'models/session', [ir])).not.toContain('~pk');
    });
  });
});
