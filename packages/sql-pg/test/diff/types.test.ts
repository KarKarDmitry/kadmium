import { describe, it, expect } from 'vitest';
import {
  pgType,
  normalizePgType,
  isPrimaryField,
  renderDefault,
  irToColumns,
  expectedIndexes,
  expectedForeignKeys,
} from '../../src/diff/types';
import type { IrField } from '../../src/diff/types';

const irs = [
  {
    name: 'User',
    fields: {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
      name: { type: 'string', nullable: false, unique: false },
    },
  },
  {
    name: 'Post',
    fields: {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
      title: { type: 'string', nullable: false, unique: false },
      author: { type: 'ref', ref: 'User', nullable: false, unique: false },
    },
  },
];

describe('pgType', () => {
  it('primary → integer by default', () => {
    expect(pgType('id', { type: 'primary', nullable: false, unique: true }, [])).toBe('integer');
  });

  it('primary with uuid db_type → uuid', () => {
    expect(pgType('id', { type: 'primary', nullable: false, unique: true, spec: { db_type: 'uuid' } }, [])).toBe('uuid');
  });

  it('primary with string db_type → varchar', () => {
    expect(pgType('id', { type: 'primary', nullable: false, unique: true, spec: { db_type: 'string' } }, [])).toBe('character varying');
  });

  it('primary with numeric db_type → numeric', () => {
    expect(pgType('id', { type: 'primary', nullable: false, unique: true, spec: { db_type: 'numeric' } }, [])).toBe('numeric');
  });

  it('ref resolves to target PK type', () => {
    const f: IrField = { type: 'ref', ref: 'User', nullable: false, unique: false };
    expect(pgType('author', f, irs)).toBe('integer');
  });

  it('ref with unknown target falls through', () => {
    const f: IrField = { type: 'ref', ref: 'Unknown', nullable: false, unique: false };
    expect(pgType('author', f, irs)).toBe('text');
  });

  it('string → varchar', () => {
    expect(pgType('name', { type: 'string', nullable: false, unique: false }, [])).toBe('character varying');
  });

  it('number → integer', () => {
    expect(pgType('age', { type: 'number', nullable: false, unique: false }, [])).toBe('integer');
  });

  it('int → integer', () => {
    expect(pgType('count', { type: 'int', nullable: false, unique: false }, [])).toBe('integer');
  });

  it('bigint → bigint', () => {
    expect(pgType('views', { type: 'bigint', nullable: false, unique: false }, [])).toBe('bigint');
  });

  it('decimal → numeric', () => {
    expect(pgType('price', { type: 'decimal', nullable: false, unique: false }, [])).toBe('numeric');
  });

  it('float → double precision', () => {
    expect(pgType('score', { type: 'float', nullable: false, unique: false }, [])).toBe('double precision');
  });

  it('boolean → boolean', () => {
    expect(pgType('active', { type: 'boolean', nullable: false, unique: false }, [])).toBe('boolean');
  });

  it('date → date', () => {
    expect(pgType('birthday', { type: 'date', nullable: false, unique: false }, [])).toBe('date');
  });

  it('datetime → timestamp', () => {
    expect(pgType('created', { type: 'datetime', nullable: false, unique: false }, [])).toBe('timestamp without time zone');
  });

  it('time → timestamp', () => {
    expect(pgType('start', { type: 'time', nullable: false, unique: false }, [])).toBe('timestamp without time zone');
  });

  it('uuid → uuid', () => {
    expect(pgType('token', { type: 'uuid', nullable: false, unique: false }, [])).toBe('uuid');
  });

  it('unknown type → text', () => {
    expect(pgType('x', { type: 'jsonb', nullable: false, unique: false }, [])).toBe('text');
  });
});

describe('normalizePgType', () => {
  it('character varying → varchar', () => {
    expect(normalizePgType('character varying')).toBe('varchar');
  });

  it('timestamp without time zone → timestamp', () => {
    expect(normalizePgType('timestamp without time zone')).toBe('timestamp');
  });

  it('time without time zone → time', () => {
    expect(normalizePgType('time without time zone')).toBe('time');
  });

  it('double precision → float8', () => {
    expect(normalizePgType('double precision')).toBe('float8');
  });

  it('integer → integer', () => {
    expect(normalizePgType('integer')).toBe('integer');
  });

  it('int4 → integer', () => {
    expect(normalizePgType('int4')).toBe('integer');
  });

  it('varchar(255) → varchar', () => {
    expect(normalizePgType('varchar(255)')).toBe('varchar');
  });

  it('numeric → numeric', () => {
    expect(normalizePgType('numeric')).toBe('numeric');
  });

  it('decimal → numeric', () => {
    expect(normalizePgType('decimal')).toBe('numeric');
  });

  it('bigint → bigint', () => {
    expect(normalizePgType('bigint')).toBe('bigint');
  });

  it('case insensitive', () => {
    expect(normalizePgType('VARCHAR')).toBe('varchar');
  });
});

describe('isPrimaryField', () => {
  it('isPrimary: true → true', () => {
    expect(isPrimaryField({ type: 'string', nullable: false, unique: false, isPrimary: true })).toBe(true);
  });

  it('type: primary → true', () => {
    expect(isPrimaryField({ type: 'primary', nullable: false, unique: true })).toBe(true);
  });

  it('neither → false', () => {
    expect(isPrimaryField({ type: 'string', nullable: false, unique: false })).toBe(false);
  });
});

describe('renderDefault', () => {
  it('no default → null', () => {
    expect(renderDefault({ type: 'string', nullable: false, unique: false })).toBeNull();
  });

  it('boolean true', () => {
    expect(renderDefault({ type: 'boolean', nullable: false, unique: false, spec: { default: true } })).toBe('true');
  });

  it('boolean false', () => {
    expect(renderDefault({ type: 'boolean', nullable: false, unique: false, spec: { default: 'false' } })).toBe('false');
  });

  it('number default', () => {
    expect(renderDefault({ type: 'number', nullable: false, unique: false, spec: { default: 42 } })).toBe('42');
  });

  it('string default with single quote escape', () => {
    expect(renderDefault({ type: 'string', nullable: false, unique: false, spec: { default: "O'Brien" } })).toBe("'O''Brien'");
  });

  it('string default with backslash escape', () => {
    expect(renderDefault({ type: 'string', nullable: false, unique: false, spec: { default: 'path\\to\\file' } })).toBe("'path\\\\to\\\\file'");
  });

  it('string default with backslash and single quote', () => {
    expect(renderDefault({ type: 'string', nullable: false, unique: false, spec: { default: "it's a \\path" } })).toBe("'it''s a \\\\path'");
  });

  it('uuid default', () => {
    expect(renderDefault({ type: 'uuid', nullable: false, unique: false, spec: { default: 'abc-123' } })).toBe("'abc-123'");
  });

  it('datetime with Date object', () => {
    const d = new Date('2024-01-15T00:00:00.000Z');
    expect(renderDefault({ type: 'datetime', nullable: false, unique: false, spec: { default: d } })).toBe("'2024-01-15T00:00:00.000Z'");
  });

  it('datetime with string', () => {
    expect(renderDefault({ type: 'datetime', nullable: false, unique: false, spec: { default: '2024-01-15' } })).toBe("'2024-01-15'");
  });
});

describe('irToColumns', () => {
  it('filters sourceModel fields', () => {
    const fields: Record<string, IrField> = {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
      name: { type: 'string', nullable: false, unique: false },
      posts: { type: 'ref', ref: 'Post', nullable: false, unique: false, sourceModel: 'Post' },
    };
    const cols = irToColumns('users', fields, irs);
    expect(cols.length).toBe(2);
    expect(cols.map((c) => c.name)).toEqual(['id', 'name']);
  });

  it('sets alias as column name', () => {
    const fields: Record<string, IrField> = {
      is_flagged: { type: 'boolean', nullable: false, unique: false, alias: 'flagged' },
    };
    const cols = irToColumns('t', fields, []);
    expect(cols[0].name).toBe('flagged');
  });

  it('primary key is unique and autoIncrement', () => {
    const fields: Record<string, IrField> = {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
    };
    const cols = irToColumns('t', fields, []);
    expect(cols[0].isUnique).toBe(true);
    expect(cols[0].autoIncrement).toBe(true);
  });

  it('uuid PK is not autoIncrement', () => {
    const fields: Record<string, IrField> = {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true, spec: { db_type: 'uuid' } },
    };
    const cols = irToColumns('t', fields, []);
    expect(cols[0].autoIncrement).toBe(false);
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

  it('index: true field gets index', () => {
    const fields: Record<string, IrField> = {
      status: { type: 'string', nullable: false, unique: false, index: true },
    };
    const idx = expectedIndexes('t', fields);
    expect(idx.length).toBe(1);
  });

  it('skips sourceModel fields', () => {
    const fields: Record<string, IrField> = {
      posts: { type: 'ref', ref: 'Post', nullable: false, unique: false, sourceModel: 'Post' },
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
      user_id: { type: 'ref', ref: 'User', nullable: false, unique: false, alias: 'user_id' },
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
      posts: { type: 'ref', ref: 'Post', nullable: false, unique: false, sourceModel: 'Post' },
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
      user_id: { type: 'ref', ref: 'User', nullable: false, unique: false, alias: 'user_id' },
    };
    const fks = expectedForeignKeys('posts', fields, irs);
    expect(fks[0].name).toBe('fk_posts_user_id');
  });
});
