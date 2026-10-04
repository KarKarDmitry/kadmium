import { describe, it, expect } from 'vitest';
import {
  isPrimaryField,
  irToColumns,
  expectedIndexes,
  expectedForeignKeys,
} from '../../src/diff/expected';
import { stubDialect } from './fixtures';
import type {
  IrField,
  IrModel,
  ReferentialAction,
} from '@karkardmitry/kadmium-sql-types';

const fld = (type: string, spec?: Record<string, unknown>): IrField => ({
  type,
  nullable: false,
  unique: false,
  spec,
});

const irs: IrModel[] = [
  {
    name: 'User',
    collection: 'users',
    fields: {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
      name: { type: 'string', nullable: false, unique: false },
    },
  },
  {
    name: 'Post',
    collection: 'posts',
    fields: {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
      title: { type: 'string', nullable: false, unique: false },
      author: { type: 'ref', ref: 'User', nullable: false, unique: false },
    },
  },
];

describe('isPrimaryField', () => {
  it('isPrimary: true → true', () => {
    expect(
      isPrimaryField({
        type: 'string',
        nullable: false,
        unique: false,
        isPrimary: true,
      }),
    ).toBe(true);
  });

  it('type: primary → true', () => {
    expect(
      isPrimaryField({ type: 'primary', nullable: false, unique: true }),
    ).toBe(true);
  });

  it('neither → false', () => {
    expect(
      isPrimaryField({ type: 'string', nullable: false, unique: false }),
    ).toBe(false);
  });
});

describe('irToColumns', () => {
  it('filters sourceModel fields', () => {
    const fields: Record<string, IrField> = {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
      name: { type: 'string', nullable: false, unique: false },
      posts: {
        type: 'ref',
        ref: 'Post',
        nullable: false,
        unique: false,
        sourceModel: 'Post',
      },
    };
    const cols = irToColumns('users', fields, irs, stubDialect);
    expect(cols.length).toBe(2);
    expect(cols.map((c) => c.name)).toEqual(['id', 'name']);
  });

  it('sets alias as column name', () => {
    const fields: Record<string, IrField> = {
      is_flagged: {
        type: 'boolean',
        nullable: false,
        unique: false,
        alias: 'flagged',
      },
    };
    const cols = irToColumns('t', fields, [], stubDialect);
    expect(cols[0].name).toBe('flagged');
  });

  it('primary key is unique and autoIncrement', () => {
    const fields: Record<string, IrField> = {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
    };
    const cols = irToColumns('t', fields, [], stubDialect);
    expect(cols[0].isUnique).toBe(true);
    expect(cols[0].autoIncrement).toBe(true);
  });

  it('uuid PK is not autoIncrement', () => {
    const fields: Record<string, IrField> = {
      id: {
        type: 'primary',
        nullable: false,
        unique: true,
        isPrimary: true,
        spec: { db_type: 'uuid' },
      },
    };
    const cols = irToColumns('t', fields, [], stubDialect);
    expect(cols[0].autoIncrement).toBe(false);
  });

  it('two primary keys throw instead of rendering 42710', () => {
    const fields: Record<string, IrField> = {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
      uid: {
        type: 'uuid',
        nullable: false,
        unique: true,
        isPrimary: true,
      },
    };
    expect(() => irToColumns('users', fields, [], stubDialect)).toThrow(
      /id, uid/,
    );
  });

  it('type: primary counts as PK even without the isPrimary flag', () => {
    // Рукописный IR может пометить ключ типом, забыв флаг. DDL-слой считает
    // его первичным (`isPrimaryField`), поэтому и проверка обязана видеть оба
    // признака — иначе она пропустила бы ровно тот случай, ради которого есть.
    const fields: Record<string, IrField> = {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
      uid: { type: 'primary', nullable: false, unique: true },
    };
    expect(() => irToColumns('users', fields, [], stubDialect)).toThrow(
      /id, uid/,
    );
  });

  it('model without PK is allowed', () => {
    const fields: Record<string, IrField> = {
      id: { type: 'string', nullable: false, unique: false },
    };
    const cols = irToColumns('t', fields, [], stubDialect);
    expect(cols[0].isPrimary).toBeFalsy();
  });
});

describe('expectedIndexes', () => {
  it('unique field gets index', () => {
    const fields: Record<string, IrField> = {
      email: { type: 'string', nullable: false, unique: true },
    };
    const idx = expectedIndexes('users', fields);
    expect(idx.length).toBe(1);
    expect(idx[0].isUnique).toBe(true);
    expect(idx[0].columns).toEqual(['email']);
  });

  it('ref field gets index', () => {
    const fields: Record<string, IrField> = {
      author: { type: 'ref', ref: 'User', nullable: false, unique: false },
    };
    const idx = expectedIndexes('posts', fields);
    expect(idx.length).toBe(1);
    expect(idx[0].name).toBe('idx_posts_author');
  });

  it('one-to-one ref gets a unique index', () => {
    const fields: Record<string, IrField> = {
      user: {
        type: 'ref',
        ref: 'User',
        nullable: false,
        unique: false,
        relation: 'one-to-one',
      },
    };
    const idx = expectedIndexes('profiles', fields);
    expect(idx.length).toBe(1);
    expect(idx[0].name).toBe('idx_profiles_user');
    expect(idx[0].isUnique).toBe(true);
  });

  it('many-to-one ref keeps a non-unique index', () => {
    const fields: Record<string, IrField> = {
      author: {
        type: 'ref',
        ref: 'User',
        nullable: false,
        unique: false,
        relation: 'many-to-one',
      },
    };
    const idx = expectedIndexes('posts', fields);
    expect(idx.length).toBe(1);
    expect(idx[0].isUnique).toBe(false);
  });

  it('a sourceModel one-to-one inverse stays unindexed', () => {
    // Уникальность должна достаться владельцу FK, а не обратной стороне:
    // иначе индекс встал бы на колонку, которой у таблицы нет.
    const fields: Record<string, IrField> = {
      user: {
        type: 'ref',
        ref: 'User',
        nullable: false,
        unique: false,
        relation: 'one-to-one',
        sourceModel: 'Profile',
      },
    };
    expect(expectedIndexes('users', fields).length).toBe(0);
  });

  it('index: true field gets index', () => {
    const fields: Record<string, IrField> = {
      status: { type: 'string', nullable: false, unique: false, index: true },
    };
    const idx = expectedIndexes('t', fields);
    expect(idx.length).toBe(1);
  });

  it('skips sourceModel fields', () => {
    const fields: Record<string, IrField> = {
      posts: {
        type: 'ref',
        ref: 'Post',
        nullable: false,
        unique: false,
        sourceModel: 'Post',
      },
    };
    expect(expectedIndexes('t', fields).length).toBe(0);
  });

  it('skips primary fields', () => {
    const fields: Record<string, IrField> = {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
    };
    expect(expectedIndexes('t', fields).length).toBe(0);
  });

  it('alias used in index name and columns', () => {
    const fields: Record<string, IrField> = {
      user_id: {
        type: 'ref',
        ref: 'User',
        nullable: false,
        unique: false,
        alias: 'user_id',
      },
    };
    const idx = expectedIndexes('posts', fields);
    expect(idx[0].name).toBe('idx_posts_user_id');
    expect(idx[0].columns).toEqual(['user_id']);
  });
});

describe('expectedForeignKeys', () => {
  it('ref field creates FK', () => {
    const fields: Record<string, IrField> = {
      author: { type: 'ref', ref: 'User', nullable: false, unique: false },
    };
    const fks = expectedForeignKeys('posts', fields, irs);
    expect(fks.length).toBe(1);
    expect(fks[0].refTable).toBe('user');
    expect(fks[0].columns).toEqual(['author']);
    expect(fks[0].refColumns).toEqual(['id']);
  });

  it('skips sourceModel fields', () => {
    const fields: Record<string, IrField> = {
      posts: {
        type: 'ref',
        ref: 'Post',
        nullable: false,
        unique: false,
        sourceModel: 'Post',
      },
    };
    expect(expectedForeignKeys('t', fields, irs).length).toBe(0);
  });

  it('skips ref without target model', () => {
    const fields: Record<string, IrField> = {
      tag: { type: 'ref', ref: 'Tag', nullable: false, unique: false },
    };
    expect(expectedForeignKeys('t', fields, irs).length).toBe(0);
  });

  it('alias used in FK name', () => {
    const fields: Record<string, IrField> = {
      user_id: {
        type: 'ref',
        ref: 'User',
        nullable: false,
        unique: false,
        alias: 'user_id',
      },
    };
    const fks = expectedForeignKeys('posts', fields, irs);
    expect(fks[0].name).toBe('fk_posts_user_id');
  });

  describe('referential actions', () => {
    const withActions = (
      onDelete?: ReferentialAction,
      onUpdate?: ReferentialAction,
    ): Record<string, IrField> => ({
      author: {
        type: 'ref',
        ref: 'User',
        nullable: false,
        unique: false,
        onDelete,
        onUpdate,
      },
    });

    it('reads onDelete from the field', () => {
      const fks = expectedForeignKeys('posts', withActions('CASCADE'), irs);
      expect(fks[0].onDelete).toBe('CASCADE');
    });

    it('reads onUpdate from the field', () => {
      const fks = expectedForeignKeys(
        'posts',
        withActions(undefined, 'RESTRICT'),
        irs,
      );
      expect(fks[0].onUpdate).toBe('RESTRICT');
    });

    it('carries both independently', () => {
      const fks = expectedForeignKeys(
        'posts',
        withActions('SET NULL', 'NO ACTION'),
        irs,
      );
      expect(fks[0].onDelete).toBe('SET NULL');
      expect(fks[0].onUpdate).toBe('NO ACTION');
    });

    it('every action passes through untouched', () => {
      for (const action of [
        'NO ACTION',
        'CASCADE',
        'SET NULL',
        'RESTRICT',
        'SET DEFAULT',
      ] as const) {
        expect(
          expectedForeignKeys('posts', withActions(action), irs)[0].onDelete,
        ).toBe(action);
        expect(
          expectedForeignKeys('posts', withActions(undefined, action), irs)[0]
            .onUpdate,
        ).toBe(action);
      }
    });

    it('absent action becomes NO ACTION — what Postgres does by default', () => {
      const fks = expectedForeignKeys('posts', withActions(), irs);
      expect(fks[0].onDelete).toBe('NO ACTION');
      expect(fks[0].onUpdate).toBe('NO ACTION');
    });

    it('only onDelete set leaves onUpdate at the default', () => {
      const fks = expectedForeignKeys('posts', withActions('CASCADE'), irs);
      expect(fks[0].onUpdate).toBe('NO ACTION');
    });

    it('inverse ref with an action still produces no FK', () => {
      const fields: Record<string, IrField> = {
        posts: {
          type: 'ref',
          ref: 'Post',
          nullable: false,
          unique: false,
          sourceModel: 'Post',
          onDelete: 'CASCADE',
        },
      };
      expect(expectedForeignKeys('user', fields, irs)).toHaveLength(0);
    });
  });
});
