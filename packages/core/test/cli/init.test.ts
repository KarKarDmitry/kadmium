import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { init } from '../../src/cli/init';

const TEMPLATES = [
  'kadmium.config.ts',
  'src/models/index.ts',
  'src/models/user.ts',
  'scripts/generate-types.ts',
  'scripts/check-types.ts',
];

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), 'kadmium-init-'));
}

describe('init', () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('creates template files and .types/.gitkeep', () => {
    const dir = makeProjectDir();
    dirs.push(dir);

    init(dir);

    for (const file of TEMPLATES) {
      expect(existsSync(join(dir, file))).toBe(true);
    }
    expect(existsSync(join(dir, '.types/.gitkeep'))).toBe(true);
  });

  it('merges generate/check scripts into package.json, preserving existing', () => {
    const dir = makeProjectDir();
    dirs.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'proj', scripts: { custom: 'echo hi' } }),
      'utf8',
    );

    init(dir);

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.custom).toBe('echo hi');
    expect(pkg.scripts.generate).toMatch(/generate-types/);
    expect(pkg.scripts.check).toMatch(/check-types/);
  });

  it('does not overwrite existing files on second run', () => {
    const dir = makeProjectDir();
    dirs.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'proj', scripts: {} }),
      'utf8',
    );

    init(dir);
    const marker = '// marker: do not lose me';
    writeFileSync(join(dir, 'kadmium.config.ts'), marker, 'utf8');

    init(dir);

    expect(readFileSync(join(dir, 'kadmium.config.ts'), 'utf8')).toBe(marker);

    const pkg1 = JSON.parse(
      readFileSync(join(dir, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string | number> };
    const generateScripts = Object.entries(pkg1.scripts).filter(
      ([name]) => name === 'generate' || name === 'check',
    );
    expect(generateScripts).toHaveLength(2);
  });

  it('writes project files when only a parent dir is missing', () => {
    const dir = makeProjectDir();
    dirs.push(dir);
    const nested = join(dir, 'a/b/c');
    mkdirSync(nested, { recursive: true });

    init(nested);

    expect(existsSync(join(nested, 'kadmium.config.ts'))).toBe(true);
  });
});
