import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { compileModel } from '../../src/model/compile';
import { Model } from '../../src/model';
import f from '../../src/model/fields';
import {
  REFERENTIAL_ACTION_INPUTS,
  toReferentialAction,
} from '../../src/ir/index';

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

describe('compileModel', () => {
  beforeEach(() => Model.clear());
  afterEach(() => Model.clear());

  describe('normalizeType', () => {
    it('maps all known types correctly', () => {
      Model.register(User);
      const ir = compileModel(new User());
      expect(ir.fields.name.type).toBe('string');
      expect(ir.fields.age.type).toBe('int');
      expect(ir.fields.active.type).toBe('boolean');
    });

    // Схлопывание `time` в `datetime` делало ветку `pgType('time')` мёртвым
    // кодом: колонка `time` не создавалась, а `db:push` считал схему актуальной.
    it('maps time to time', () => {
      class M extends Model {
        created = f.datetime.time;
      }
      const ir = compileModel(new M());
      expect(ir.fields.created.type).toBe('time');
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

  describe('referential actions', () => {
    it('carries onDelete/onUpdate onto the owning ref field, uppercased', () => {
      class Comment extends Model {
        post = f.ref.target(Post).onDelete('cascade').onUpdate('set null');
      }
      Model.register(User, Post, Comment);
      const ir = compileModel(new Comment());
      expect(ir.fields.post.onDelete).toBe('CASCADE');
      expect(ir.fields.post.onUpdate).toBe('SET NULL');
    });

    it('every action maps to its SQL spelling', () => {
      for (const action of REFERENTIAL_ACTION_INPUTS) {
        const field = f.ref.target(Post).onDelete(action).$build();
        expect(toReferentialAction(field.onDelete!)).toBe(action.toUpperCase());
      }
    });

    it('two-word and single-word actions both map, no toUpperCase() surprises', () => {
      expect(toReferentialAction('set null')).toBe('SET NULL');
      expect(toReferentialAction('no action')).toBe('NO ACTION');
      expect(toReferentialAction('cascade')).toBe('CASCADE');
      expect(toReferentialAction('restrict')).toBe('RESTRICT');
      expect(toReferentialAction('set default')).toBe('SET DEFAULT');
    });

    it('absent when the DSL call is absent', () => {
      Model.register(User, Post);
      const ir = compileModel(new Post());
      expect(ir.fields.author.onDelete).toBeUndefined();
      expect(ir.fields.author.onUpdate).toBeUndefined();
    });

    it('not copied to the inverse side — FK lives on the owning field', () => {
      class Comment extends Model {
        post = f.ref.target(Post, 'comments').onDelete('cascade');
      }
      Model.register(User, Post, Comment);
      const inverse = compileModel(new Post());
      expect(inverse.fields.comments).toBeDefined();
      expect(inverse.fields.comments.sourceModel).toBe('Comment');
      expect(inverse.fields.comments.onDelete).toBeUndefined();
    });

    it('follows inheritance: child inherits the action of a parent field', () => {
      class Base extends Model {
        owner = f.ref.target(User).onDelete('cascade');
      }
      class Child extends Base {
        title = f.string;
      }
      Model.register(User, Base, Child);
      const ir = compileModel(new Child());
      expect(ir.fields.owner.onDelete).toBe('CASCADE');
    });

    it('one-to-one owner carries the action like any other owner', () => {
      class Profile extends Model {
        user = f.ref.target(User).oneToOne().onDelete('cascade');
      }
      Model.register(User, Profile);
      const ir = compileModel(new Profile());
      expect(ir.fields.user.relation).toBe('one-to-one');
      expect(ir.fields.user.onDelete).toBe('CASCADE');
    });

    it('a notNull owner with cascade still compiles', () => {
      class Tag extends Model {
        post = f.ref.target(Post).notNull().onDelete('cascade');
      }
      Model.register(User, Post, Tag);
      const ir = compileModel(new Tag());
      expect(ir.fields.post.nullable).toBe(false);
      expect(ir.fields.post.onDelete).toBe('CASCADE');
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

  describe('inheritance', () => {
    it('child inherits inverse refs from parent via prototype walk', () => {
      class Base extends Model {
        name = f.string;
      }
      class Child extends Base {
        extra = f.string;
      }
      class Comment extends Model {
        target = f.ref.target(Base).manyToOne().inverse('comments');
      }
      Model.register(Base, Child, Comment);

      const ir = compileModel(new Child());
      expect(ir.fields.name).toBeDefined();
      expect(ir.fields.extra).toBeDefined();
      expect(ir.fields.comments).toBeDefined();
      expect(ir.fields.comments.type).toBe('ref');
      expect(ir.fields.comments.sourceModel).toBe('Comment');
      expect(ir.fields.comments.ref).toBe('Comment');
    });

    it('does not overwrite inverse field already declared on child', () => {
      class Base extends Model {
        name = f.string;
      }
      class Child extends Base {
        comments = f.string;
      }
      class Comment extends Model {
        target = f.ref.target(Base).manyToOne().inverse('comments');
      }
      Model.register(Base, Child, Comment);

      const ir = compileModel(new Child());
      expect(ir.fields.comments.type).toBe('string');
    });

    it('skips non-instantiable parent silently', () => {
      abstract class Base extends Model {
        name = f.string;
      }
      class Child extends Base {
        extra = f.string;
      }
      Model.register(Child);

      const ir = compileModel(new Child());
      expect(ir.fields.name).toBeDefined();
      expect(ir.fields.extra).toBeDefined();
    });
  });

  /**
   * Первичный ключ — единственный на модель.
   *
   * Раньше дефолтный `id` жил свойством на `Model`, и объявление своего PK
   * в наследнике его не вытесняло: инициализатор базового класса отрабатывал
   * первым, в IR попадали оба поля с `isPrimary`, а `CREATE TABLE` падал в
   * PostgreSQL с 42710. Дефолт переехал в `$build()` — эти тепы фиксируют,
   * что объявленный PK всегда выигрывает, а два PK больше невозможны.
   */
  describe('primary key', () => {
    it('добавляет дефолтный bigint PK, если модель не объявила свой', () => {
      const ir = compileModel(new User());
      expect(ir.fields.id.isPrimary).toBe(true);
      expect(ir.fields.id.type).toBe('bigint');
      expect(ir.fields.id.nullable).toBe(false);
    });

    it('объявленный PK вытесняет дефолтный id', () => {
      class ByUid extends Model {
        uid = f.pk.uuid;
        label = f.string;
      }
      const ir = compileModel(new ByUid());
      expect(ir.fields.id).toBeUndefined();
      expect(ir.fields.uid.isPrimary).toBe(true);
      expect(ir.fields.uid.type).toBe('uuid');
    });

    it('в IR остаётся ровно один isPrimary', () => {
      class ByUid extends Model {
        uid = f.pk.uuid;
      }
      const primaries = Object.values(compileModel(new ByUid()).fields).filter(
        (f) => f.isPrimary,
      );
      expect(primaries).toHaveLength(1);
    });

    it('явный id = f.pk не дублируется дефолтом', () => {
      class Explicit extends Model {
        id = f.pk.uuid;
      }
      const ir = compileModel(new Explicit());
      expect(ir.fields.id.isPrimary).toBe(true);
      expect(ir.fields.id.type).toBe('uuid');
      expect(Object.values(ir.fields).filter((f) => f.isPrimary)).toHaveLength(
        1,
      );
    });

    it('PK поддерживает .alias(): колонка переименовывается', () => {
      class Aliased extends Model {
        uid = f.pk.uuid.alias('user_uid');
      }
      const ir = compileModel(new Aliased());
      expect(ir.fields.uid.alias).toBe('user_uid');
      expect(ir.fields.uid.isPrimary).toBe(true);
    });

    it('alias не вытесняет дефолт, если PK не объявлен', () => {
      const ir = compileModel(new User());
      expect(ir.fields.id.alias).toBe('id');
    });

    it('кидает, если разработчик объявил два PK', () => {
      class TwoPk extends Model {
        id = f.pk;
        uid = f.pk.uuid;
      }
      expect(() => compileModel(new TwoPk())).toThrow(
        /несколько primary-ключей/,
      );
    });

    it('сообщение ошибки перечисляет имена обоих PK', () => {
      class TwoPk extends Model {
        id = f.pk;
        uid = f.pk.uuid;
      }
      expect(() => compileModel(new TwoPk())).toThrow(/id, uid/);
    });

    it('явный не-PK id запрещает добавление дефолта', () => {
      class WithExplicitNonPkId extends Model {
        id = f.string;
      }
      const ir = compileModel(new WithExplicitNonPkId());
      expect(ir.fields.id.isPrimary).toBeFalsy();
      expect(ir.fields.id.type).toBe('string');
    });

    it('порядок полей: дефолтный id идёт первым', () => {
      const ir = compileModel(new User());
      expect(Object.keys(ir.fields)[0]).toBe('id');
    });
  });
});
