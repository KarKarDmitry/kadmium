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
import { describe, it, expect, afterEach } from 'vitest';
import { generateCommand } from '../../src/cli/generate';
import { checkCommand } from '../../src/cli/check';

const FIXTURES = (() => {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, 'test/cli/fixtures/models'),
    join(cwd, 'packages/core/test/cli/fixtures/models'),
  ];
  return candidates.find((c) => existsSync(c))!.replace(/\\/g, '/');
})();

function makeProject(): { dir: string; config: string; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'kadmium-generate-'));
  const config = join(dir, 'kadmium.config.ts');
  const output = join(dir, 'generated-types.ts');
  const payload = {
    modelSources: [`${FIXTURES}/**/*.ts`],
    output,
  };
  writeFileSync(
    config,
    `export default ${JSON.stringify(payload)} as const;\n`,
    'utf8',
  );
  return { dir, config, output };
}

describe('generateCommand', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('writes augment types for registered models', async () => {
    const { dir, output } = makeProject();
    dirs.push(dir);

    await generateCommand(dir);

    expect(existsSync(output)).toBe(true);
    const content = readFileSync(output, 'utf8');
    expect(content).toContain('declare module');
    expect(content).toContain('User');
  });

  it('checkCommand passes right after generate', async () => {
    const { dir, output } = makeProject();
    dirs.push(dir);

    await generateCommand(dir);
    await expect(checkCommand(dir)).resolves.toBeUndefined();

    writeFileSync(output, `${readFileSync(output, 'utf8')}// tamper\n`, 'utf8');
    await expect(checkCommand(dir)).rejects.toThrow(/outdated/);
  });
});
