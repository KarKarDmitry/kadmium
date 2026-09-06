import { describe, it, expect } from 'vitest';
import f from '../../../src/model/fields';

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
});
