import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnv } from '../../src/cli/env';

const KEYS = ['KADMIUM_TEST_A', 'KADMIUM_TEST_B', 'KADMIUM_TEST_Q'];

function makeEnvDir(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kadmium-env-'));
  writeFileSync(join(dir, '.env'), content, 'utf8');
  return dir;
}

describe('loadEnv', () => {
  beforeEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  it('loads KEY=VALUE pairs into process.env', () => {
    loadEnv(makeEnvDir('KADMIUM_TEST_A=hello\nKADMIUM_TEST_B=world\n'));
    expect(process.env.KADMIUM_TEST_A).toBe('hello');
    expect(process.env.KADMIUM_TEST_B).toBe('world');
  });

  it('strips surrounding quotes', () => {
    loadEnv(makeEnvDir('KADMIUM_TEST_A="quoted"\nKADMIUM_TEST_B=\'single\'\n'));
    expect(process.env.KADMIUM_TEST_A).toBe('quoted');
    expect(process.env.KADMIUM_TEST_B).toBe('single');
  });

  it('does not override variables already set', () => {
    process.env.KADMIUM_TEST_A = 'existing';
    loadEnv(makeEnvDir('KADMIUM_TEST_A=file\nKADMIUM_TEST_B=loaded\n'));
    expect(process.env.KADMIUM_TEST_A).toBe('existing');
    expect(process.env.KADMIUM_TEST_B).toBe('loaded');
  });

  it('ignores missing or blank .env files', () => {
    const dir = makeEnvDir('');
    expect(() => loadEnv(dir)).not.toThrow();
    const empty = join(tmpdir(), `kadmium-env-missing-${Date.now()}`);
    expect(() => loadEnv(empty)).not.toThrow();
  });
});