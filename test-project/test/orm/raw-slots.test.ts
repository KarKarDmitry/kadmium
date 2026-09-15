import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { slot } from '@karkardmitry/kadmium-core';
import { User } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
});

afterAll(async () => {
  await h.adapter.end();
});

describe('slots: unfilled guard in execute (A2)', () => {
  it('go() with an unfilled slot rejects', async () => {
    await expect(
      h.orm.single(User).where((u) => u.id.eq(slot('id'))).go(),
    ).rejects.toThrow(/Unfilled slot\(s\): id/);
  });
});