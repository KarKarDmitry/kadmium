import { describe, it, expect } from 'vitest';
import f from '../../../src/model/fields';
import {
  REFERENTIAL_ACTION_INPUTS,
  type ReferentialActionInput,
} from '../../../src/ir/index';

class Post extends Model {
  title = f.string;
}

import { Model } from '../../../src/model';

describe('ReferenceFieldBuilder', () => {
  it('.target(Post).$build: ref=Post, _type=ref', () => {
    const field = f.ref.target(Post).$build();
    expect(field.ref).toBe('Post');
    expect(field._meta._type).toBe('ref');
  });

  it('without .target() throws', () => {
    expect(() => f.ref.$build()).toThrow('target model is not set');
  });

  it('.target(Post).oneToOne(): relation=one-to-one', () => {
    const field = f.ref.target(Post).oneToOne().$build();
    expect(field.relation).toBe('one-to-one');
  });

  it('.target(Post).manyToOne(): relation=many-to-one', () => {
    const field = f.ref.target(Post).manyToOne().$build();
    expect(field.relation).toBe('many-to-one');
  });

  it('default relation is one-to-many', () => {
    const field = f.ref.target(Post).$build();
    expect(field.relation).toBe('one-to-many');
  });

  it('.target(Post, "author"): inverse=author', () => {
    const field = f.ref.target(Post, 'author').$build();
    expect(field.inverse).toBe('author');
  });

  it('.fk("post_id"): foreignKey=post_id', () => {
    const field = f.ref.target(Post).fk('post_id').$build();
    expect(field.foreignKey).toBe('post_id');
  });

  it('without .fk(): foreignKey absent', () => {
    const field = f.ref.target(Post).$build();
    expect(field.foreignKey).toBeUndefined();
  });

  it('.inverseRelation returns correct inverse', () => {
    expect(f.ref.target(Post).inverseRelation).toBe('many-to-one');
    expect(f.ref.target(Post).manyToOne().inverseRelation).toBe('one-to-many');
    expect(f.ref.target(Post).oneToOne().inverseRelation).toBe('one-to-one');
  });

  it('inherited .notNull().unique() work', () => {
    const field = f.ref.target(Post).notNull().unique().$build();
    expect(field.db.nullable).toBe(false);
    expect(field.db.unique).toBe(true);
  });

  describe('referential actions', () => {
    it('every action round-trips through .onDelete()', () => {
      for (const action of REFERENTIAL_ACTION_INPUTS) {
        const field = f.ref.target(Post).onDelete(action).$build();
        expect(field.onDelete).toBe(action);
      }
    });

    it('every action round-trips through .onUpdate()', () => {
      for (const action of REFERENTIAL_ACTION_INPUTS) {
        const field = f.ref.target(Post).onUpdate(action).$build();
        expect(field.onUpdate).toBe(action);
      }
    });

    it('actions stay lowercase — the DSL form, not the SQL form', () => {
      const field = f.ref.target(Post).onDelete('cascade').$build();
      expect(field.onDelete).not.toBe('CASCADE');
    });

    it('without .onDelete()/.onUpdate(): both absent, so the DB default applies', () => {
      const field = f.ref.target(Post).$build();
      expect(field.onDelete).toBeUndefined();
      expect(field.onUpdate).toBeUndefined();
    });

    it('chains with .target().fk().inverse() and stays on the same builder', () => {
      const field = f.ref
        .target(Post, 'comments')
        .fk('post_id')
        .onDelete('cascade')
        .onUpdate('restrict')
        .$build();
      expect(field.ref).toBe('Post');
      expect(field.inverse).toBe('comments');
      expect(field.foreignKey).toBe('post_id');
      expect(field.onDelete).toBe('cascade');
      expect(field.onUpdate).toBe('restrict');
    });

    it('only the named action is set', () => {
      const field = f.ref.target(Post).onUpdate('cascade').$build();
      expect(field.onUpdate).toBe('cascade');
      expect(field.onDelete).toBeUndefined();
    });

    it('last call wins when set twice', () => {
      const field = f.ref
        .target(Post)
        .onDelete('cascade')
        .onDelete('set null')
        .$build();
      expect(field.onDelete).toBe('set null');
    });

    it('f.ref getter gives a fresh builder — no leak between fields', () => {
      f.ref.target(Post).onDelete('cascade').$build();
      expect(f.ref.target(Post).$build().onDelete).toBeUndefined();
    });

    it('unknown action throws (JS callers, not just TS)', () => {
      expect(() =>
        f.ref
          .target(Post)
          .onDelete('cascde' as ReferentialActionInput)
          .$build(),
      ).toThrow('unknown onDelete action "cascde"');
      expect(() =>
        f.ref
          .target(Post)
          .onUpdate('CASCADE' as ReferentialActionInput)
          .$build(),
      ).toThrow('unknown onUpdate action "CASCADE"');
    });

    it(".onDelete('set null') with .notNull() throws", () => {
      expect(() =>
        f.ref.target(Post).notNull().onDelete('set null').$build(),
      ).toThrow("onDelete('set null') needs a nullable field");
    });

    it('call order does not matter: .onDelete() before .notNull() throws too', () => {
      expect(() =>
        f.ref.target(Post).onDelete('set null').notNull().$build(),
      ).toThrow("onDelete('set null') needs a nullable field");
    });

    it(".onUpdate('set null') with .notNull() throws", () => {
      expect(() =>
        f.ref.target(Post).notNull().onUpdate('set null').$build(),
      ).toThrow("onUpdate('set null') needs a nullable field");
    });

    it("'set default' with .notNull() is allowed — Postgres only fails at delete time", () => {
      const field = f.ref
        .target(Post)
        .notNull()
        .onDelete('set default')
        .$build();
      expect(field.onDelete).toBe('set default');
      expect(field.db.nullable).toBe(false);
    });

    it("'cascade' with .notNull() is allowed", () => {
      const field = f.ref.target(Post).notNull().onDelete('cascade').$build();
      expect(field.onDelete).toBe('cascade');
    });

    it('missing target is reported before anything about actions', () => {
      expect(() => f.ref.onDelete('set null').notNull().$build()).toThrow(
        'target model is not set',
      );
    });
  });
});
