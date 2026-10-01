import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Post as PostModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed } from '../../fixtures';

/**
 * Граница между конфигурацией билдера и терминалами агрегатов.
 *
 * `count()` игнорирует limit/offset (S2), `exists()` — offset (S3): оба
 * считают по всей выборке, а не по странице. Это осознанное решение —
 * «сколько таких строк» и «есть ли такие строки» не должны зависеть от
 * пагинации, — и оно легко ломается рефакторингом рендера, поэтому
 * зафиксировано явно.
 */

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('select: count()/exists() не зависят от limit/offset (S2/S3)', () => {
  it('count() игнорирует limit и offset', async () => {
    const n = await h.orm.select(PostModel).limit(1).offset(1).count().go();
    expect(n).toBe(3);
  });

  it('exists() игнорирует offset, но уважает where', async () => {
    const yes = await h.orm
      .select(PostModel)
      .offset(5)
      .where((p) => p.title.eq('Hello Postgres'))
      .exists()
      .go();
    expect(yes).toBe(true);

    const no = await h.orm
      .select(PostModel)
      .offset(5)
      .where((p) => p.title.eq('Nothing Like This'))
      .exists()
      .go();
    expect(no).toBe(false);
  });
});
