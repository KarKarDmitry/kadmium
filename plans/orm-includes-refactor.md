# ORM Includes Refactor — Record-based includes

## Goal

Replace tuple-based `.include()` with Record-based `.include()` to eliminate recursive conditional types and reduce type complexity by ~70%.

## Final API

```typescript
orm.single(User)
  .include({
    posts: {
      alias: 'p',
      select: p => [p.id, p.content.as('body')],
      where: p => p.published.eq(true),
      order: p => p.createdAt,
      limit: 10,
      include: { author: true, comments: true },
    },
    author: true,
  })
  .select(t => [t.id, t.name])
  .go()
// → { id: number; name: string; posts: { id: number; body: string }[]; author: User }
```

## Result type

```typescript
type IncludeResult<M, C> =
  ShapeOf<M> & {
    [K in keyof C & keyof RelationsOf<M>]:
      ResolveRelation<M, K, C[K]>
  };

type ResolveRelation<M, K, C> =
  C extends true
    ? RelationResult<M, K>                              // { author: User }
    : C extends { include: infer Nested }
      ? (RelTarget<M, K> & ResolveIncludes<...>)[] | ... // nested include
      : RelationResult<M, K>;
```

## Files to change

| # | File | Action | Effort |
|---|------|--------|--------|
| 1 | `codegen/generate-model.ts` | Add `~relInfo` generation | 0.5d |
| 2 | `orm/types/includes.d.ts` | **Create** — IncludeConfig, IncludeResult, helpers | 1d |
| 3 | `orm/types/proxy.d.ts` | Replace RelationProxy, delete 6 duplicate types | 0.5d |
| 4 | `orm/field-builders/relation.ts` | Simplify Relation (0 generic), delete IRelationBuilder | 1d |
| 5 | `orm/builders/single.ts` | Remove R param, new .include(), runtime resolution | 1.5d |
| 6 | `orm/builders/multi.ts` | Same changes for multi-query | 1d |
| 7 | `orm/types/relations.d.ts` | Delete 7 types, update ISingleTableQuery/IFirstQuery | 0.5d |
| 8 | `orm/builders/query-proxies.ts` | Remove createRelationProxy | 0.5d |
| 9 | `test-project/.types/~models.augment.ts` | Regenerate | 0.5d |
| 10 | `test-project/test/*.test.ts` | Update all include calls | 1d |
| 11 | `orm/index.ts` | Update exports | 0.5d |
| **Total** | | | **~7.5d** |

## Key types to delete

From `relations.d.ts`: `ToOneRelation`, `ToManyRelation`, `ProcessRelation`, `BuildIncludedResultRecur`, `BuildIncludedResult`, `GetIncludedType`, `UnionToIntersection`

From `proxy.d.ts`: `UnionToIntersection`, `ToOneRelation`, `ToManyRelation`, `RelationsOf`, `ShapeOf`, `RelationProxy`

Delete: `IRelationBuilder` interface from `relation.ts`

## Key types to keep

From `relations.d.ts`: `Evaluate`, `GetFieldName`, `GetFieldType`, `AnySelectable`, `FlatFinalResult`

From `proxy.d.ts`: `NullableMethods`, `FieldTypeToFilter`, `AddNullable`, `FilterProxy`, `SelectProxy`, `OrderProxy`, `UpdateFinalizer`, `AliasesMap`, `MultiFilterProxy`, `MultiSelectProxy`, `MultiRelationProxy`, `ObjectForAlias`, `FinalResult`

## Migration

| Old | New |
|-----|-----|
| `.include(t => [t.posts.as('p').where(...)])` | `.include({ posts: { alias: 'p', where: ... } })` |
| `.include(t => [t.author])` | `.include({ author: true })` |
| `.include(t => [t.posts.select(p => [p.id])])` | `.include({ posts: { select: p => [p.id] } })` |
| `.include(t => [t.posts.include(c => [c.author])])` | `.include({ posts: { include: { author: true } } })` |
