import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { array } from '@karkardmitry/kadmium-core';
import { User as UserModel } from '../../src/models';
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

describe('in(array([...])) — один массив-параметр = ANY($1) против PG', () => {
  it('number: array() даёт те же строки, что обычный список', async () => {
    const viaArray = await h.orm
      .single(UserModel)
      .where((u) => u.age.in(array([25, 30])))
      .go();
    const viaList = await h.orm
      .single(UserModel)
      .where((u) => u.age.in([25, 30]))
      .go();
    expect(viaArray.map((r) => r.name).sort()).toEqual(
      viaList.map((r) => r.name).sort(),
    );
    expect(viaArray.length).toBeGreaterThan(0);
  });

  it('string: array() работает и для строк', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.name.in(array(['Alice', 'Carol'])))
      .go();
    expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Carol']);
  });
});