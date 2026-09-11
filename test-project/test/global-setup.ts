// Загрузка моделей/конфига в собранных пакетах (dist CJS) идёт через нативный
// require() пользовательского TS — как в проде, ему нужен ts-node.
import 'ts-node/register';

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
