import { pgDialect } from '@karkardmitry/kadmium-sql-pg';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { AppCore, OrmManager, type ModelIR } from '@karkardmitry/kadmium-core';
import { PgAdapter } from '@karkardmitry/kadmium-sql-pg';
import {
  User,
  Post,
  Comment,
  Bureau,
  Country,
  Region,
  UserAccount,
  Profile,
  LoginSession,
  CalendarEvent,
  Measurement,
} from '../src/models';

/**
 * Все модели проекта — целиком, а не только те, что трогает конкретный тест.
 * `resetData` строит порядок `DELETE` из FK-графа IR, и незарегистрированная
 * модель выпала бы из графа вместе со своей таблицей.
 */
const MODELS = [
  User,
  Post,
  Comment,
  Bureau,
  Country,
  Region,
  UserAccount,
  Profile,
  LoginSession,
  CalendarEvent,
  Measurement,
];

/** Загрузить .env в process.env (не перезатирая уже заданные). */
export function loadEnv(): void {
  const p = resolve(process.cwd(), '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export interface Harness {
  adapter: PgAdapter;
  app: AppCore;
  orm: OrmManager;
  irs: Map<string, ModelIR>;
}

/**
 * Поднять ORM поверх готового реестра моделей.
 *
 * Сознательно НЕ через `KadmiumApp.init()`: тот подтягивает `kadmium.config.ts`
 * и восемь файлов моделей через `await import()` — в тестах это компиляция TS
 * в рантайме, ~9 файлов на КАЖДЫЙ тестовый файл (vitest держит модули изолированными).
 * На прогоне из 46 файлов это 414 компиляций и ~0.6с накладных на файл — больше,
 * чем сами тесты.
 *
 * Здесь модельные классы уже импортированы статически, поэтому остаётся собрать
 * `AppCore` напрямую. Параметры подключения повторяют `kadmium.config.ts`;
 * сам путь загрузки конфига проверяется отдельно в `test/index.test.ts`.
 */
export async function makeHarness(): Promise<Harness> {
  loadEnv();
  const adapter = new PgAdapter({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE || 'kadmium_test',
    login: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
  });
  const app = new AppCore();
  app.sqlAdapter = adapter;
  app.register(MODELS);
  await app.registry.validate();
  const orm = new OrmManager(app, adapter);
  const irs = new Map<string, ModelIR>();
  for (const ir of app.allIrs) irs.set(ir.name, ir);
  return { adapter, app, orm, irs };
}

/** Полностью очистить БД (drop всех таблиц). */
export async function dropAllTables(adapter: PgAdapter): Promise<void> {
  for (const t of await adapter.ddl.inspectTables()) {
    await adapter.ddl.dropTable(t.name);
  }
}

/** Создать схему из моделей через computeDiff + applyDiff. */
export async function syncSchema(h: Harness): Promise<void> {
  const { computeDiff, applyDiff } = await import('@karkardmitry/kadmium-core');
  const diff = await computeDiff(h.app.allIrs, h.adapter.ddl, pgDialect);
  await applyDiff(diff, h.adapter.ddl);
}

/**
 * Порядок `DELETE FROM`, в котором FK не мешают: ребёнок раньше родителя.
 *
 * Рёбра выводятся из IR: поле с `ref` и без `sourceModel` — это и есть FK,
 * владеющий колонкой, ровно то же условие, по которому миграции строят
 * ограничения. Порядок не придётся править руками при добавлении модели.
 * Обратный маппинг `lowerCase(имя) → коллекция` — обратный к
 * `refTable: f.ref.toLowerCase()` на стороне миграций, поэтому работает и для
 * многословных имён.
 *
 * Порядок берётся из IR, а не из `inspectAllForeignKeys`: такая интроспекция
 * стоит ~120мс — дороже самой очистки.
 */
function deleteStatements(h: Harness): string[] {
  const irs = [...h.app.allIrs];
  const collectionOf = new Map(
    irs.map((ir) => [ir.name.toLowerCase(), ir.collection]),
  );

  const parentsOf = new Map<string, Set<string>>();
  for (const ir of irs) parentsOf.set(ir.collection, new Set());
  for (const ir of irs) {
    for (const f of Object.values(ir.fields)) {
      if (f.sourceModel || !f.ref) continue;
      const parent = collectionOf.get(f.ref.toLowerCase());
      if (parent) parentsOf.get(ir.collection)?.add(parent);
    }
  }

  // Обратное ребро: у «region» ребёнок «country». Обход в глубину с выводом
  // после потомков даёт именно нужный порядок — ребёнок раньше родителя.
  // Именно обратный по сравнению с «родитель выведен раньше», иначе `DELETE`
  // родителя спотыкается о ещё живой FK.
  const childrenOf = new Map<string, string[]>();
  for (const table of parentsOf.keys()) childrenOf.set(table, []);
  for (const [table, parents] of parentsOf) {
    for (const parent of parents) childrenOf.get(parent)?.push(table);
  }

  const statements: string[] = [];
  const visited = new Set<string>();
  const visit = (table: string): void => {
    if (visited.has(table)) return;
    visited.add(table);
    // Self-reference: ребёнок === table, рекурсия увидит visited и выйдет.
    for (const child of childrenOf.get(table) ?? []) visit(child);
    statements.push(`DELETE FROM "${table}";`);
  };
  for (const table of parentsOf.keys()) visit(table);

  if (visited.size !== parentsOf.size) {
    const stuck = [...parentsOf.keys()].filter((t) => !visited.has(t));
    throw new Error(`cycle in foreign keys, cannot order: ${stuck.join(', ')}`);
  }
  return statements;
}

/**
 * Последовательности схемы, кэшированные на адаптер.
 *
 * Имена приходят из каталога, а не выводятся из соглашения `<table>_id_seq`:
 * у uuid-PK таблиц (`user_account`) последовательности нет, и угадывание
 * именем упёрлось бы в ошибку. Кэш на адаптер — запрос один на файл, а не на
 * каждый тест.
 */
const sequenceCache = new WeakMap<PgAdapter, string[]>();

async function sequenceNames(adapter: PgAdapter): Promise<string[]> {
  const cached = sequenceCache.get(adapter);
  if (cached) return cached;
  const rows = (await adapter.ddl.raw(
    "SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'",
  )) as unknown as Array<{ sequencename: string }>;
  const names = rows.map((r) => r.sequencename);
  sequenceCache.set(adapter, names);
  return names;
}

/**
 * Очистить данные во всех таблицах, не трогая схему.
 *
 * Две команды вместо `dropAllTables` + `syncSchema` — те дают ~31
 * последовательную DDL-команду, по round trip на каждую. `TRUNCATE` был бы
 * одной командой, но он ~215мс против ~3мс у `DELETE`: TRUNCATE переписывает
 * каталог, а строк в тестовой базе единицы.
 *
 * Последовательности возвращаются к 1 — это часть контракта харнеса, а не
 * оптимизация: тесты зовут `findById(1)`, и без сброса они зависели бы от
 * того, сколько строк вставил предыдущий тест. `setval(..., 1, false)`
 * дешевле `ALTER SEQUENCE ... RESTART` (~10мс против ~14мс на семь
 * последовательностей) и не требует перебора строк — одним `unnest`.
 */
export async function resetData(h: Harness): Promise<void> {
  const adapter = h.adapter;
  await adapter.ddl.raw(deleteStatements(h).join('\n'));

  const sequences = await sequenceNames(adapter);
  if (sequences.length > 0) {
    await adapter.ddl.raw(
      'SELECT setval(s::regclass, 1, false) FROM unnest($1::text[]) AS s',
      [sequences],
    );
  }
}
