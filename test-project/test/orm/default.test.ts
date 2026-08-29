import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { renderDefault } from '@karkardmitry/kadmium-sql-pg';
import { f } from '@karkardmitry/kadmium-core';
import { Post as PostModel, Comment as CommentModel } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed } from '../fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('renderDefault: SQL literal per field type', () => {
  it('string -> quoted literal', () => {
    expect(
      renderDefault({ type: 'string', spec: { default: 'hello' } } as any),
    ).toBe("'hello'");
  });

  it('string with single quote is escaped', () => {
    expect(
      renderDefault({ type: 'string', spec: { default: "it's" } } as any),
    ).toBe("'it''s'");
  });

  it('int/bigint -> bare integer', () => {
    expect(renderDefault({ type: 'int', spec: { default: 5 } } as any)).toBe(
      '5',
    );
    expect(
      renderDefault({ type: 'bigint', spec: { default: 10 } } as any),
    ).toBe('10');
  });

  it('decimal/float/numeric -> bare number', () => {
    expect(
      renderDefault({ type: 'decimal', spec: { default: 5.5 } } as any),
    ).toBe('5.5');
    expect(
      renderDefault({ type: 'float', spec: { default: 1.25 } } as any),
    ).toBe('1.25');
    expect(
      renderDefault({ type: 'numeric', spec: { default: 3 } } as any),
    ).toBe('3');
  });

  it('boolean -> true/false', () => {
    expect(
      renderDefault({ type: 'boolean', spec: { default: true } } as any),
    ).toBe('true');
    expect(
      renderDefault({ type: 'boolean', spec: { default: false } } as any),
    ).toBe('false');
  });

  it('datetime (Date) -> quoted ISO', () => {
    const d = new Date('2024-01-01T00:00:00.000Z');
    expect(
      renderDefault({ type: 'datetime', spec: { default: d } } as any),
    ).toBe("'2024-01-01T00:00:00.000Z'");
  });

  it('uuid -> quoted literal', () => {
    expect(
      renderDefault({ type: 'uuid', spec: { default: 'abc-123' } } as any),
    ).toBe("'abc-123'");
  });

  it('no default -> null', () => {
    expect(renderDefault({ type: 'string', spec: {} } as any)).toBeNull();
    expect(renderDefault({ type: 'string' } as any)).toBeNull();
    expect(
      renderDefault({ type: 'int', spec: { default: null } } as any),
    ).toBeNull();
  });
});

describe('IntegerFieldBuilder validates integer defaults', () => {
  it('accepts an integer default', () => {
    const field = f.number.default(5);
    expect(field.$build().spec.default).toBe(5);
  });

  it('rejects a fractional default for an integer field', () => {
    expect(() => f.number.default(5.5)).toThrow(/integer/i);
  });

  it('decimal field accepts fractional and integer defaults', () => {
    expect(f.number.decimal.default(5.5).$build().spec.default).toBe(5.5);
    expect(f.number.decimal.default(2).$build().spec.default).toBe(2);
  });
});

describe('defaults reach DDL and apply on insert (integration)', () => {
  it('int/bool/string defaults are present on the created columns', async () => {
    const postCols = await h.adapter.ddl.inspectColumns('post');
    const commentCols = await h.adapter.ddl.inspectColumns('comment');
    expect(postCols.find((c) => c.name === 'views')!.defaultValue).toContain(
      '0',
    );
    expect(postCols.find((c) => c.name === 'published')!.defaultValue).toMatch(
      /true/,
    );
    expect(commentCols.find((c) => c.name === 'text')!.defaultValue).toMatch(
      /''/,
    );
  });

  it('omitting int field applies the column default', async () => {
    const post = await h.orm.single(PostModel).create({
      title: 'No Views',
      content: 'body',
      published: true,
    });
    expect(post.views).toBe(0);
  });

  it('omitting boolean field applies the column default', async () => {
    const post = await h.orm.single(PostModel).create({
      title: 'No Published',
      content: 'body',
      views: 1,
    });
    expect(post.published).toBe(true);
  });

  it('omitting string field applies the column default', async () => {
    const comment = await h.orm.single(CommentModel).create({
      post: null,
      user: null,
    });
    expect(comment.text).toBe('');
  });
});
