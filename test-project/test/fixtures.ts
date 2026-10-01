import {
  User as UserModel,
  Post as PostModel,
  Comment as CommentModel,
} from '../src/models';
import { type Harness } from './helpers';

export interface SeedData {
  alice: Record<string, unknown>;
  bob: Record<string, unknown>;
  carol: Record<string, unknown>;
  p1: Record<string, unknown>;
  p2: Record<string, unknown>;
  p3: Record<string, unknown>;
}

/**
 * Засеять данные через ORM-слой одним батчем на таблицу.
 *
 * Три round trip вместо девяти: `createMany` с `transaction: false` шлёт
 * один INSERT без BEGIN/COMMIT, а транзакция по умолчанию была бы включена
 * (`transaction` — шаг с дефолтом `true`, как в legacy `createMany`). Батч
 * возвращает вставленные строки, поэтому id достаются из `RETURNING` и
 * вручную задавать их не нужно.
 *
 * Порядок важен: постам нужны id пользователей, комментариям — id постов.
 */
export async function seed(h: Harness): Promise<SeedData> {
  const { orm } = h;

  const [alice, bob, carol] = await orm
    .single(UserModel)
    .createMany(
      [
        {
          name: 'Alice',
          email: 'alice@test.com',
          age: 30,
          active: true,
          registeredAt: new Date('2024-01-01T00:00:00Z'),
        },
        {
          name: 'Bob',
          email: 'bob@test.com',
          age: 25,
          active: false,
          registeredAt: new Date('2024-02-01T00:00:00Z'),
        },
        {
          name: 'Carol',
          email: 'carol@test.com',
          age: 40,
          active: true,
          registeredAt: new Date('2024-03-01T00:00:00Z'),
        },
      ],
      { transaction: false },
    )
    .go();

  const [p1, p2, p3] = await orm
    .single(PostModel)
    .createMany(
      [
        {
          title: 'Hello Postgres',
          content: 'first post body',
          published: true,
          views: 10,
          author: alice.id,
        },
        {
          title: 'Draft Post',
          content: 'draft body',
          published: false,
          views: 0,
          author: alice.id,
        },
        {
          title: 'Bob Writes',
          content: 'third body',
          published: true,
          views: 5,
          author: bob.id,
        },
      ],
      { transaction: false },
    )
    .go();

  await orm
    .single(CommentModel)
    .createMany(
      [
        { text: 'nice!', post: p1.id, user: alice.id },
        { text: 'lgtm', post: p1.id, user: bob.id },
        { text: 'meh', post: p3.id, user: carol.id },
      ],
      { transaction: false },
    )
    .go();

  return { alice, bob, carol, p1, p2, p3 };
}

/**
 * Сбросить данные к известному состоянию: очистить таблицы + засеять.
 *
 * Схему не трогает — её создаёт `globalSetup` один раз на прогон, и ни один
 * тест, берущий этот хелпер, схему не меняет.
 */
export async function resetAndSeed(h: Harness): Promise<SeedData> {
  const { resetData } = await import('./helpers');
  await resetData(h);
  return seed(h);
}

/**
 * Пересоздать схему с нуля и засеять.
 *
 * Для тестов, которые меняют саму схему (смена referential-действия у FK) и
 * оставили бы её в другом состоянии для следующего теста файла. Остальным не
 * нужен: `dropAllTables` + `syncSchema` — это ~31 последовательная DDL-команда,
 * и платить за неё в каждом `beforeEach` незачем.
 */
export async function resetSchemaAndSeed(h: Harness): Promise<SeedData> {
  const { dropAllTables, syncSchema } = await import('./helpers');
  await dropAllTables(h.adapter);
  await syncSchema(h);
  return seed(h);
}
