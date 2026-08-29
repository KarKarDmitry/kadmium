import { makeHarness, dropAllTables, syncSchema } from './helpers';
import { seed } from './fixtures';

/**
 * globalSetup — выполняется один раз ДО запуска тестов (до `vitest run`).
 * Создаёт схему БД и засеивает данные через ORM-слой.
 */
export default async function setup(): Promise<void> {
  const h = await makeHarness();
  try {
    await dropAllTables(h.adapter);
    await syncSchema(h);
    await seed(h);
    console.log('[global-setup] schema created + seeded via ORM layer');
  } finally {
    await h.adapter.end();
  }
}
