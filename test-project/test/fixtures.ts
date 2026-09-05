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
 * Засеять данные через ORM-слой (orm.single(...).create()).
 * Возвращает вставленные строки для последующих ассертов.
 */
export async function seed(h: Harness): Promise<SeedData> {
  const { orm } = h;

  const alice = await orm.single(UserModel).create({
    name: 'Alice',
    email: 'alice@test.com',
    age: 30,
    active: true,
    registeredAt: new Date('2024-01-01T00:00:00Z'),
  }).go();
  const bob = await orm.single(UserModel).create({
    name: 'Bob',
    email: 'bob@test.com',
    age: 25,
    active: false,
    registeredAt: new Date('2024-02-01T00:00:00Z'),
  }).go();
  const carol = await orm.single(UserModel).create({
    name: 'Carol',
    email: 'carol@test.com',
    age: 40,
    active: true,
    registeredAt: new Date('2024-03-01T00:00:00Z'),
  }).go();

  const p1 = await orm.single(PostModel).create({
    title: 'Hello Postgres',
    content: 'first post body',
    published: true,
    views: 10,
    author: alice.id,
  }).go();
  const p2 = await orm.single(PostModel).create({
    title: 'Draft Post',
    content: 'draft body',
    published: false,
    views: 0,
    author: alice.id,
  }).go();
  const p3 = await orm.single(PostModel).create({
    title: 'Bob Writes',
    content: 'third body',
    published: true,
    views: 5,
    author: bob.id,
  }).go();

  await orm.single(CommentModel).create({
    text: 'nice!',
    post: p1.id,
    user: alice.id,
  }).go();
  await orm.single(CommentModel).create({
    text: 'lgtm',
    post: p1.id,
    user: bob.id,
  }).go();
  await orm.single(CommentModel).create({
    text: 'meh',
    post: p3.id,
    user: carol.id,
  }).go();

  return { alice, bob, carol, p1, p2, p3 };
}

/** Сбросить БД к известному состоянию: пересоздать схему + засеять. */
export async function resetAndSeed(h: Harness): Promise<SeedData> {
  const { dropAllTables, syncSchema } = await import('./helpers');
  await dropAllTables(h.adapter);
  await syncSchema(h);
  return seed(h);
}
