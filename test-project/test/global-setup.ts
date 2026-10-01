// Модели/конфиг больше не грузятся через `await import()` пользовательского TS,
// поэтому ts-node здесь не нужен — харнес собирает AppCore из статических импортов.
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
  } finally {
    await h.adapter.end();
  }
}
