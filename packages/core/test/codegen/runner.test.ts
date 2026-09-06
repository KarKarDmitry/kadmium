import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateAll, generateToFile, checkSync } from '../../src/codegen/runner';
import type { ModelIR } from '../../src/ir/index';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';

function makeIr(name: string): ModelIR {
  return { name, collection: name.toLowerCase(), fields: {} };
}

describe('generateAll', () => {
  it('empty IRs → header + export {}', () => {
    const out = generateAll([], {});
    expect(out).toContain('// Auto-generated');
    expect(out).toContain('export {};');
  });

  it('model with missing path → skipped', () => {
    const ir = makeIr('User');
    const out = generateAll([ir], {});
    expect(out).not.toContain('User');
  });

  it('multiple models → declarations concatenated', () => {
    const u = makeIr('User');
    const p = makeIr('Post');
    const out = generateAll([u, p], { User: 'models/user', Post: 'models/post' });
    expect(out).toContain("declare module 'models/user'");
    expect(out).toContain("declare module 'models/post'");
  });
});

describe('generateToFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('empty IRs → warns, no write', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateToFile([], {}, 'output/types.d.ts');
    expect(warn).toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('normal → mkdirSync + writeFileSync', () => {
    const ir = makeIr('User');
    generateToFile([ir], { User: 'models/user' }, 'output/types.d.ts');
    expect(mkdirSync).toHaveBeenCalledWith('output', { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      'output/types.d.ts',
      expect.any(String),
      'utf-8',
    );
  });
});

describe('checkSync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('empty IRs → returns true', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(checkSync([], {}, 'types.d.ts')).toBe(true);
    log.mockRestore();
  });

  it('file not found → returns false', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (existsSync as any).mockReturnValue(false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(checkSync([makeIr('User')], { User: 'models/user' }, 'types.d.ts')).toBe(false);
    error.mockRestore();
  });

  it('file outdated → returns false', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (existsSync as any).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (readFileSync as any).mockReturnValue('// old content');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(checkSync([makeIr('User')], { User: 'models/user' }, 'types.d.ts')).toBe(false);
    error.mockRestore();
  });

  it('file up to date → returns true', () => {
    const ir = makeIr('User');
    const expected = generateAll([ir], { User: 'models/user' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (existsSync as any).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (readFileSync as any).mockReturnValue(expected);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(checkSync([ir], { User: 'models/user' }, 'types.d.ts')).toBe(true);
    log.mockRestore();
  });
});
