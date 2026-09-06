import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { compileModel } from '../../src/ir/compile';
import { Model } from '../../src/model';
import f from '../../src/model/fields';

class User extends Model {
  name = f.string;
  age = f.number;
  active = f.bool;
}

class Post extends Model {
  title = f.string;
  author = f.ref.target(User).manyToOne().fk('authorId').inverse('posts');
}

class Profile extends Model {
  user = f.ref.target(User).oneToOne().inverse('profile');
}

function clearRegistry() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Model as any).registry.clear();
}

describe('compileModel', () => {
  beforeEach(() => clearRegistry());
  afterEach(() => clearRegistry());

  describe('normalizeType', () => {
    it('maps all known types correctly', () => {
      Model.register(User);
      const ir = compileModel(new User());
      expect(ir.fields.name.type).toBe('string');
      expect(ir.fields.age.type).toBe('int');
      expect(ir.fields.active.type).toBe('boolean');
    });

    it('maps time to datetime', () => {
      class M extends Model {
        created = f.datetime.time;
      }
      const ir = compileModel(new M());
      expect(ir.fields.created.type).toBe('datetime');
    });

    it('maps datetime to datetime', () => {
      class M extends Model {
        created = f.datetime;
      }
      const ir = compileModel(new M());
      expect(ir.fields.created.type).toBe('datetime');
    });

    it('maps date to date', () => {
      class M extends Model {
        d = f.datetime.date;
      }
      const ir = compileModel(new M());
      expect(ir.fields.d.type).toBe('date');
    });

    it('maps bigint via pk', () => {
      const ir = compileModel(new User());
      expect(ir.fields.id.type).toBe('bigint');
    });

    it('maps decimal via f.number.decimal', () => {
      class M extends Model {
        price = f.number.decimal;
      }
      const ir = compileModel(new M());
      expect(ir.fields.price.type).toBe('decimal');
    });
  });

  describe('basic compilation', () => {
    it('compiles model name and collection', () => {
      const ir = compileModel(new User());
      expect(ir.name).toBe('User');
      expect(ir.collection).toBe('user');
    });

    it('converts PascalCase to snake_case', () => {
      class BlogPost extends Model {
        title = f.string;
      }
      const ir = compileModel(new BlogPost());
      expect(ir.collection).toBe('blog_post');
    });

    it('compiles all field types', () => {
      const ir = compileModel(new User());
      expect(ir.fields.name).toBeDefined();
      expect(ir.fields.age).toBeDefined();
      expect(ir.fields.active).toBeDefined();
      expect(ir.fields.id).toBeDefined();
    });
  });

  describe('isPrimary', () => {
    it('sets isPrimary from _meta._type === primary', () => {
      const ir = compileModel(new User());
      expect(ir.fields.id.isPrimary).toBe(true);
    });

    it('non-PK fields have isPrimary false or undefined', () => {
      const ir = compileModel(new User());
      expect(ir.fields.name.isPrimary).toBeFalsy();
    });
  });

  describe('alias', () => {
    it('defaults alias to field name', () => {
      const ir = compileModel(new User());
      expect(ir.fields.name.alias).toBe('name');
    });

    it('uses explicit alias when set', () => {
      class M extends Model {
        n = f.string.alias('display_name');
      }
      const ir = compileModel(new M());
      expect(ir.fields.n.alias).toBe('display_name');
    });
  });

  describe('tsType', () => {
    it('sets tsType from field builder', () => {
      const ir = compileModel(new User());
      expect(ir.fields.name.tsType).toBe('string');
      expect(ir.fields.age.tsType).toBe('number');
      expect(ir.fields.active.tsType).toBe('boolean');
    });

    it('defaults to unknown when tsType not set', () => {
      class M extends Model {
        x = f.pk;
      }
      const ir = compileModel(new M());
      expect(ir.fields.x.tsType).toBe('number');
    });
  });

  describe('spec', () => {
    it('spec with default is present', () => {
      class M extends Model {
        name = f.string.default('hello');
      }
      const ir = compileModel(new M());
      expect(ir.fields.name.spec).toEqual({ default: 'hello' });
    });

    it('spec with db_type is present', () => {
      class M extends Model {
        id = f.pk.uuid;
      }
      const ir = compileModel(new M());
      expect(ir.fields.id.spec).toEqual({ db_type: 'uuid' });
    });

    it('empty spec is undefined', () => {
      const ir = compileModel(new User());
      expect(ir.fields.name.spec).toBeUndefined();
    });
  });

  describe('ref fields', () => {
    it('copies ref metadata', () => {
      Model.register(User, Post);
      const ir = compileModel(new Post());
      expect(ir.fields.author.ref).toBe('User');
      expect(ir.fields.author.relation).toBe('many-to-one');
      expect(ir.fields.author.foreignKey).toBe('authorId');
    });

    it('ref field tsType is target model name', () => {
      Model.register(User, Post);
      const ir = compileModel(new Post());
      expect(ir.fields.author.tsType).toBe('User');
    });
  });

  describe('inverse refs', () => {
    it('adds inverse ref as virtual field', () => {
      Model.register(User, Post);
      const ir = compileModel(new User());
      expect(ir.fields.posts).toBeDefined();
      expect(ir.fields.posts.type).toBe('ref');
      expect(ir.fields.posts.sourceModel).toBe('Post');
    });

    it('skips inverse if field already declared', () => {
      class PostWithAuthor extends Model {
        title = f.string;
        author = f.ref.target(User).manyToOne().inverse('author');
      }
      Model.register(User, PostWithAuthor);
      const ir = compileModel(new User());
      expect(ir.fields.author).toBeDefined();
    });

    it('inverse ref nullable only for one-to-one', () => {
      Model.register(User, Profile);
      const ir = compileModel(new User());
      expect(ir.fields.profile).toBeDefined();
      expect(ir.fields.profile.nullable).toBe(true);
    });

    it('inverse one-to-many is not nullable', () => {
      Model.register(User, Post);
      const ir = compileModel(new User());
      expect(ir.fields.posts.nullable).toBe(false);
    });
  });

  describe('sourceFile', () => {
    it('passes through sourceFile', () => {
      const ir = compileModel(new User(), 'models/user.ts');
      expect(ir.sourceFile).toBe('models/user.ts');
    });

    it('sourceFile is undefined when not provided', () => {
      const ir = compileModel(new User());
      expect(ir.sourceFile).toBeUndefined();
    });
  });

  describe('db options', () => {
    it('string field: nullable=true, unique=false, index=false by default', () => {
      const ir = compileModel(new User());
      expect(ir.fields.name.nullable).toBe(true);
      expect(ir.fields.name.unique).toBe(false);
      expect(ir.fields.name.index).toBe(false);
    });

    it('unique field', () => {
      class M extends Model {
        email = f.string.unique();
      }
      const ir = compileModel(new M());
      expect(ir.fields.email.unique).toBe(true);
    });

    it('indexed field', () => {
      class M extends Model {
        name = f.string.index();
      }
      const ir = compileModel(new M());
      expect(ir.fields.name.index).toBe(true);
    });

    it('notNull field', () => {
      class M extends Model {
        name = f.string.notNull();
      }
      const ir = compileModel(new M());
      expect(ir.fields.name.nullable).toBe(false);
    });
  });
});
