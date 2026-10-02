import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Bureau as BureauModel,
  Comment as CommentModel,
  Country as CountryModel,
  Post as PostModel,
  Profile as ProfileModel,
  Region as RegionModel,
  User as UserModel,
  UserAccount as UserAccountModel,
} from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed } from '../../fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('returning() when the DB column differs from the property name', () => {
  it('keeps displayLabel (column display_label) in the projected row', async () => {
    const created = await h.orm
      .insert(UserAccountModel)
      .values({
        id: '00000000-0000-4000-8000-000000000011',
        displayLabel: 'Acc',
        createdBy: 1,
      })
      .go();
    const rows = await h.orm
      .update(UserAccountModel)
      .set({ displayLabel: 'Acc2' })
      .where((u) => u.displayLabel.eq('Acc'))
      .returning((u) => [u.id, u.displayLabel])
      .go();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].displayLabel).toBe('Acc2');
  });
});

describe('having() referencing an aggregate over an aliased column', () => {
  it('aggregates flagged comments by is_flagged', async () => {
    const [alice] = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .fields((u) => [u.id])
      .go();
    const post = await h.orm
      .insert(PostModel)
      .values({ title: 'Flagged Post', content: 'body', author: alice.id })
      .go();
    const other = await h.orm
      .insert(PostModel)
      .values({ title: 'Other Post', content: 'body', author: alice.id })
      .go();
    await h.orm
      .insertMany(CommentModel)
      .values([
        { text: 'flag1', flagged: true, post: post.id, user: alice.id },
        { text: 'flag2', flagged: true, post: post.id, user: alice.id },
        { text: 'flag3', flagged: false, post: post.id, user: alice.id },
        { text: 'other1', flagged: true, post: other.id, user: alice.id },
      ])
      .go();
    const rows = await h.orm
      .select(CommentModel)
      .where((c) => c.post.in([post.id, other.id]))
      .fields((c, { agg }) => [c.post, agg.count(c.flagged).as('flaggedCount')])
      .groupBy((c) => [c.post])
      .having((t) => t.flaggedCount.gt(1))
      .go();
    expect(rows).toHaveLength(1);
    expect(rows[0].post).toBe(post.id);
    expect(rows[0].flaggedCount).toBe(3);
  });
});

describe('nested to-one include at depth 3', () => {
  it('unpacks region.country.gov into plain objects', async () => {
    const bureau = await h.orm
      .insert(BureauModel)
      .values({ name: 'Budget Office' })
      .go();
    const country = await h.orm
      .insert(CountryModel)
      .values({ name: 'France', gov: bureau.id })
      .go();
    const region = await h.orm
      .insert(RegionModel)
      .values({ name: 'Ile-de-France', country: country.id })
      .go();
    const rows = await h.orm
      .select(RegionModel)
      .where((r) => r.id.eq(region.id))
      .include({ country: { include: { gov: true } } })
      .go();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(region.id);
    expect(rows[0].country.id).toBe(country.id);
    expect(rows[0].country.gov).not.toBeNull();
    expect(rows[0].country.gov.id).toBe(bureau.id);
    expect(rows[0].country.gov.name).toBe('Budget Office');
  });
});

describe('uuid primary key', () => {
  it('supports filtering via u.id.eq()', async () => {
    const id = '00000000-0000-4000-8000-000000000013';
    await h.orm
      .insert(UserAccountModel)
      .values({ id, displayLabel: 'FilterMe', createdBy: 1 })
      .go();
    const rows = await h.orm
      .select(UserAccountModel)
      .where((u) => u.id.eq(id))
      .fields((u) => [u.id, u.displayLabel])
      .go();
    expect(rows).toHaveLength(1);
    expect(rows[0].displayLabel).toBe('FilterMe');
  });
});

describe('multiword model: uuid pk, aliased column, snake_case collection', () => {
  it('round-trips UserAccount via user_account with display_label', async () => {
    const id = '00000000-0000-4000-8000-000000000014';
    const created = await h.orm
      .insert(UserAccountModel)
      .values({
        id,
        displayLabel: 'Account One',
        createdBy: 1,
      })
      .go();
    expect(created.id).toBe(id);
    expect(created.createdBy).toBe(1);
    const fetched = await h.orm
      .select(UserAccountModel)
      .fields((u) => [u.id, u.displayLabel])
      .go();
    const mine = fetched.filter((r) => r.id === id);
    expect(mine).toHaveLength(1);
    expect(mine[0].displayLabel).toBe('Account One');
    const tables = await h.adapter.ddl.inspectTables();
    expect(tables.map((t) => t.name)).toContain('user_account');
  });
});

describe('inverse one-to-one include', () => {
  it('resolves User.profile as a singular object, not an array', async () => {
    const [alice] = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .fields((u) => [u.id])
      .go();
    const profile = await h.orm
      .insert(ProfileModel)
      .values({ displayName: 'Alice Profile', user: alice.id })
      .go();
    expect(profile.user).toBe(alice.id);
    const [user] = await h.orm
      .select(UserModel)
      .where((u) => u.id.eq(alice.id))
      .include({ profile: true })
      .go();
    expect(Array.isArray(user.profile)).toBe(false);
    expect(user.profile!.id).toBe(profile.id);
    expect(user.profile!.displayName).toBe('Alice Profile');
  });
});
