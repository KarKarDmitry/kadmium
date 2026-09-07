import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Model, MODEL_MARKER } from '../../src/model';
import { ReferenceField } from '../../src/model/types/ref';
import f from '../../src/model/fields';

class User extends Model {
  name = f.string;
}

class Post extends Model {
  title = f.string;
  author = f.ref.target(User).manyToOne().fk('authorId');
}

function clearRegistry() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Model as any).registry.clear();
}

describe('Model', () => {
  beforeEach(() => clearRegistry());
  afterEach(() => clearRegistry());

  describe('$build', () => {
    it('sets _meta.name to class name', () => {
      const schema = new User().$build();
      expect(schema._meta.name).toBe('User');
    });

    it('includes default id PK field', () => {
      const schema = new User().$build();
      expect(schema.fields.id).toBeDefined();
      expect(schema.fields.id._meta._type).toBe('primary');
    });

    it('compiles all declared fields', () => {
      const schema = new User().$build();
      expect(schema.fields.name).toBeDefined();
      expect(schema.fields.name._meta._type).toBe('string');
    });

    it('ref field foreignKey defaults to alias', () => {
      Model.register(User, Post);
      const schema = new Post().$build();
      expect((schema.fields.author as ReferenceField).foreignKey).toBe(
        'authorId',
      );
    });

    it('non-field properties are ignored', () => {
      class M extends Model {
        name = f.string;
        notAField = 'hello';
      }
      const schema = new M().$build();
      expect(schema.fields.notAField).toBeUndefined();
      expect(schema.fields.name).toBeDefined();
    });
  });

  describe('$relations', () => {
    it('returns forward refs', () => {
      Model.register(User, Post);
      const relations = new Post().$relations();
      expect(relations.length).toBe(1);
      expect(relations[0].field).toBe('author');
      expect(relations[0].ref).toBe('User');
    });

    it('warns for unregistered target', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      new Post().$relations();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('$refs', () => {
    it('returns inverse refs from other models', () => {
      Model.register(User, Post);
      const refs = new User().$refs();
      expect(refs.length).toBe(1);
      expect(refs[0].sourceModel).toBe('Post');
      expect(refs[0].field).toBe('author');
    });

    it('skips self', () => {
      Model.register(User);
      const refs = new User().$refs();
      expect(refs.length).toBe(0);
    });
  });

  describe('registry', () => {
    it('register + resolve', () => {
      Model.register(User);
      expect(Model.resolve('User')).toBe(User);
    });

    it('resolve unknown returns undefined', () => {
      expect(Model.resolve('Unknown')).toBeUndefined();
    });

    it('models returns all registered', () => {
      Model.register(User, Post);
      expect(Model.models).toContain(User);
      expect(Model.models).toContain(Post);
    });

    it('duplicate register overwrites', () => {
      Model.register(User);
      Model.register(User);
      expect(Model.models.length).toBe(1);
    });
  });

  describe('inheritance', () => {
    it('child gets inverse refs from parent', () => {
      class BaseModel extends Model {
        name = f.string;
      }
      class ChildModel extends BaseModel {
        extra = f.string;
      }
      Model.register(BaseModel, Post);
      const ir = new ChildModel().$build();
      expect(ir.fields.name).toBeDefined();
      expect(ir.fields.extra).toBeDefined();
    });
  });

  describe('MODEL_MARKER', () => {
    it('is present on Model class', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((Model as any)[MODEL_MARKER]).toBe(true);
    });

    it('is present on subclass', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((User as any)[MODEL_MARKER]).toBe(true);
    });
  });
});
