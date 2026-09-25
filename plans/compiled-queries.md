# Реиспользуемые скомпилированные запросы (QuerySlots + compile + fill + orm.raw)

**Статус:** ⬜ В процессе (A✅, B✅ + multi B3/B4✅; C отложен).
Примитивы (`slot`, `sql`-тег, рендер, контракт `CompiledQuery`) — в `plans/builder-expression.md` (План 3). Этот план — верхний слой: декларация слотов через модель, терминалы билдера, заполнение параметров и выполнение в горячем цикле. Открывает **F2** (`plans/features.md`).

---

## Мотивация (перф. — главная причина)

Паттерн «общий билдер»

```ts
const visible = () => app.orm.single(User).where(t => t.tenantId.eq(tenant)).clone();
```

создаёт **на каждый вызов**:
- новый `SingleQueryBuilder`,
- новый `FilterProxy` (прокси не поддаются JIT-оптимизации),
- глубокий `clone()` SQB: рекурсивная копия where-графа, map'ы `tableContext`, массивы `joins/selects/orders`, includes с вложенными sqb.

Для высоконагруженных запросов это аллокационный шум, который ощущается. Противодействие — цепочка из контекста проекта: **`clone() → toSql() → raw()`** = скомпилировать один раз, исполнять многократно. Паттерн доводится до примитива: `compile()` на старте, `raw` в цикле — ноль прокси, ноль клонов, ноль рендера SQL, только `pool.query(text, params)`.

Параллельная проблема: **позиционные `$N` нельзя собирать руками**. SQL и параметры — неразрывная пара, выводимая из билдера. Решение — named-слоты (План 3) + `fill()` по ключам: порядок помнит компиляция, а не разработчик.

---

## QuerySlots — декларация слотов из модели

Назначение: **не писать тип слотов руками**. Типы выводятся из модели через уже существующие фантомы `SelectProxy` — это отличительная возможность, которой нет в других библиотеках.

```ts
const S = new QuerySlots(User)
  .push(u => [u.tenantId, u.createdAt.as('since'), u.id.array.as('ids')]);
// S.Def = { tenantId: number, since: Date, ids: number[] }
```

Механика извлечения:

| Выражение в `push` | Тип | Имя слота | Значение |
|---|---|---|---|
| `u.tenantId` | `SelectableField<number, 'tenantId', undefined, _>` | `tenantId` (без `.as()`) | `TFieldType` |
| `u.createdAt.as('since')` | `SelectableField<Date, 'createdAt', 'since', _>` | `since` (`TAlias`) | `TFieldType` |
| `aggregates.count('*').as('cnt')` | `AggregateField<number> & { alias:'cnt' }` | `cnt` | `TResult` |
| `u.id.array.as('ids')` | `ArrayField<number[], 'id', 'ids'>` | `ids` | `T[]` (элемент из модели) |

**ArrayField (массив-слот):** `SelectableField.array` — type-only фантом, значение-тип = `T[]` элементы из модели. Нужен для `t.id.in(S.slot('ids'))` (сейчас `in()` принимает только литерал, см. План 3). Правила:
- `ArrayField` **не extends** `SelectableField` для select-proxy: `select(u => [u.id.array])` — тип-ошибка (`ArrayField` семантически не колонка); `ToDef` принимает union `SelectableField | ArrayField`.
- `.array` и `.as()` **коммутируют**: `u.id.array.as('ids')` ≡ `u.id.as('x').array` — один и тот же слот-тип.
- `push` в runtime не вызывается, поэтому фантом ничего не исполняет.

```ts
class QuerySlots<
  TModel extends { ['~shape']: Record<string, unknown> },
  Def extends Record<string, unknown> = {},
> {
  // чисто type-level: колбэк в runtime НЕ вызывается, только накапливает Def
  push<S extends readonly (AnySelectable | AnyArrayField)[]>(
    fn: (u: SelectProxy<TModel>, aggs: AggregateFunctions) => S,
  ): QuerySlots<TModel, Def & ToDef<S>>;

  // имя ограничено Def — «чужой» alias TS режет; значение типизировано Def[K]
  slot<K extends keyof Def & string>(k: K): SlotMarker<K, Def[K]>;
}
```

`push` может вызываться повторно для расширения наборов слотов. Вводить optional-слоты (`.req`/`.opt`) решили **не** вводить — все слоты обязательные.

---

## Терминалы и выполнение

### `builder.compile()`

```ts
// плоский путь: тип руками, слоты — plain slot()
const a = app.orm.single(User)
  .where(t => t.tenantId.eq(slot('tenantId')))
  .compile<{ tenantId: number }>();

// типизированный путь: fill проверен моделью через S
const b = app.orm.single(User)
  .where(t => t.tenantId.eq(S.slot('tenantId')))
  .compile(S);
```

Имплементация: `sqb.clone()` → материализация select'ов → `adapter.toSql(sqb)` → `CompiledQuery`. `compile(S)` в рантайме проверяет: каждый слот в AST ∈ `Def` (имена не придуманы на месте), и заодно собирает `slotOrder` из рендера. `sql`-фрагмент имеет тот же терминал `.compile()`/`.compile(S)` — оба пути сходятся в `CompiledQuery`.

### `fill(input)`

- Вход — объект `{ имя: значение }`, **не порядок**.
- Валидация: лишний/недостающий ключ → throw с именами и ожиданием.
- Раскладка по `slotOrder` (индекс первого вхождения); маркер заменяется **во всех вхождениях** (dedup по имени) → `{ text, params }`.

### `orm.raw(...)`

```ts
await app.orm.raw(...compiled.fill({ tenantId, since })).go();
// или явно: const { text, params } = compiled.fill(input); orm.raw(text, params)
```

- Синтаксис: `raw({ text, params })` и `raw(text, params)` — passthrough на `adapter.raw`.
- Результат — `Record<string, unknown>[]` (сырые строки без распаковки include). Типизированные сущности — по-прежнему `.go()`.

### Горячий цикл

```ts
const compiled = /* собрать и скомпилировать ОДИН раз на старте */;

for (const req of incoming) {
  const rows = await app.orm.raw(...compiled.fill({ tenantId: req.tenant, since })).go();
}
// в цикле: ноль прокси, ноль clone(), ноль рендера — только pool.query(text, params)
```

---

## Зафиксированные решения

- **Dedup слотов по имени** — один параметр на имя; семантика «одно значение». Обрабатывается адаптером/тегом (План 3).
- **Optional-слоты** (`.req/.opt`) — не вводим; все слоты обязательны.
- **`multi.compile()` / слоты в `orm.query({...})`** — ✅ реализовано (B3/B4, `8633bd2`): `multi.select(...).compile<T>()` (плоские слоты) и `compile(S)` с `MultiQuerySlots<T, S>` (типы из алиасов). Терминал — `select()`; `single: false`; `MultiSelectResult` в `multi.ts`.
- **Плоский `slot()`** держит `any`-фантом → пропускает eq-проверку по значению (осознанный компромисс; тип задаётся в `compile<T>()`).
- **Терминал — `.compile()`** (действие, глагол); тип результата — `CompiledQuery`.
- Типы слотов из модели — ключевое отличие; eq-site проверка (`BaseFilter<TValue>`) — в Плане 3.
- **`.toSql()` депрекейтится**: публичные `single.toSql()`, `multi.toSql()`, `count().sql()`, `exists().sql()` получают `@deprecated` «только для отладки; используйте `.compile()`» — в одном из под-коммитов ниже. Внутренности (`_toSqlFrom`, `buildDebugSql`, `adapter.toSql`, AST-`toSql()`) не трогаем.
- **select/order/where-встраивание** (`sql<T>...`.as()`, `sql`...`.asc/.desc`, `where(sql`...`)`/`having(sql`...`)` + выражения `and()/or()`) — в v1 (строки C/D/E таблицы Плана 3; where-embed — `d578a5c`).

---

## Оценка сложности и порядок (зафиксировано, отложено)

Полный срез (3 крупных блока + docs) — **~1700–2200 строк** кода+тестов. Сложность по блокам:

| Блок | Что | Сложность | ~строк | Риски |
|---|---|---|---|---|
| **A. Тип-фундамент + адаптер** | `BaseFilter<TValue>`, фильтры+`V`, `SlotMarker`/`slot()`, контракт sql-types, `_renderValue`/`slotOrder`/guard | M | 350–450 | кросс-типовые `eq` в тестах; рипл по сигнатурам фильтров |
| **B. QuerySlots + compile/fill + orm.raw** | `QuerySlots`/`ToDef` (type-level), `ArrayField`+`.array`, `builder.compile()`, `fill()`, `orm.raw` | L на типах / M в целом | 600–750 | ТоDef-извлечение из фантомов — самый неопределённый кусок |
| **C. sql-тег + select/order embed + array()** | tag+перемерация+dedup, `.as()`, `.asc/.desc`, `array()`+`.in` | L | 700–900 | корректность $N/slotOrder; новые kinds в select/order рендере |
| Docs | `@deprecated` toSql, AGENTS.md, features.md | S | ~50 | — |

**Ключевые риски (по убыванию):**
1. **Тип-механика `ToDef`** (B) — извлечение `{name, value}` и `ArrayField` из фантомов `SelectProxy`; conditional-типы могут упереться → вынужденный рефактор фантомов. Нужны expect-error тесты.
2. **Порядок слотов/перенумерация** (C) — сдвиг `$N` и dedup; ошибки тихие (неверный параметр, не краш) → плотная unit-сеть.
3. **Встраивание в select/order** (C) — новые ссылки идут через `materializeSelects` и рендер select-списка; легко задеть includes/подзапросы.
4. **Кросс-типовые `eq` в тестах** (A) — `BaseFilter<TValue>` запретит `u.a.eq(u.b)` разных типов; прочесать тесты.
5. **Слоты внутри include/подзапросов** — слот в `include().where(...)` должен попасть в общий slotOrder; сюрпризы dedup во многовложенных where.

### Разбивка на под-коммиты (~300 строк/PR)

- **A1** — типизация фильтров: `BaseFilter<TValue>` + `V` + `eq/neq/...`. Самый изолированный старт; сразу выплывают кросс-типовые eq в тестах. — ✅ Done (`bbf78dc`): phantom `BaseFilter<TValue>` (`declare readonly _value`), все фильтры объявляют V, `eq/neq/gt/gte/lt/lte` → `V | BaseFilter<V>`; eq-site-тесты в `filters.test.ts` (same-V реф валиден; кросс-тип реф и голый `BaseFilter` → expected-error). Кросс-типовых `eq` в тестах не нашлось (всё уже было typed). Тип-narrowing (голый `BaseFilter` в eq теперь ошибка) — пометка в теле коммита; runtime 0.
- **A2** — слот-маркер + рендер: `SlotMarker`, `slot()`, `isHoleRef`, `_renderValue`, `slotOrder` в `toSql`, guard «unfilled». — ✅ Done (`528f9f1`): sql-types (HoleRef/SlotDefinition, `toSql` + `slotOrder?`), core `orm/slot.ts` (`SlotMarker<K, V> extends BaseFilter<V>`, плоский `slot()` → `SlotMarker<Name, any>`, `isHoleRef`), sql-pg (`ParamState { p, slotOrder? }`, слот-ветка ПЕРВОЙ в `_renderValue` до field-to-field, dedup по имени, slotOrder в toSql/update/upsert/delete, `assertNoUnfilledSlots` в обоих execute). Ветка-порядок критична (SlotMarker тоже BaseFilter); тип `HoleRef` из sql-types (sql-pg core не импортирует). `CompiledQuery`/`.fill()` — B1/B2.
- **B1** — `QuerySlots` + `.compile()` (типы, без исполнения): ToDef, `ArrayField`/`.array`, исключение из select-proxy. — ✅ Done (`931aab2`): generic `CompiledQuery<TSlots, TResult>` с `single`/`sqb`, `SqlAdapter.reshape()`, `compile()` с `QuerySlots.assertSlotNames` валидацией, compile.test (flat/typed/invariant/clone-pattern), integration через `createDebugAdapter` + `Model.clear()`.
- **B3** — `multi.select().compile()` (плоские слоты): `MultiSelectResult<S, T, C>` в `multi.ts` (`toSql`/`go`/`compile<T>()`/`compile(S)`), рантайм `sqb.clone()` → `adapter.toSql` → `MultiQuerySlots.assertSlotNames`, `single: false`. — ✅ Done (`8633bd2`): core `compile-multi.test.ts` (Equal-миррор go(), `single`, `slotOrder`/`text`, immutability, no-adapter, clone-паттерн) + integration `test-project/test/orm/compile-multi.test.ts` (join/include/order-limit/groupBy/join.on/3-table, parity `go()` vs `run(compile()).fill().go()`, переиспользование в цикле) + perf-кейсы 10–16 в `compile-performance.test.ts` (multi join/flat/order+limit/include/groupBy/ON/3-table; compiled 1 render, ×12–74).
- **B4** — `MultiQuerySlots<T, S>` (типизированные слоты multi): `BaseQuerySlots<S>` в `query-slots.ts` (общие `_seen`/`slot`/`assertSlotNames`), `QuerySlots` и `MultiQuerySlots` наследуют; `push((t: MultiSelectProxy<T>, aggs) => NS)`, `ToDef` переиспользуется. Экспорт из `orm/index.ts` и корневого `index.ts` (value `MultiQuerySlots`, type `MultiSelectResult`). — ✅ Done (`8633bd2`): typed-тесты в core/integration; nullable-поля → flat `compile<T>()` (typed слот требует non-null `~shape`).
- **B2** — исполнение: `CompiledQuery.fill()` (порядок+валидация), `OrmManager.raw`, integration против PG. — ✅ Done (`931aab2`): `fillCompiled` (замена маркеров по `slotOrder`, валидация missing/extra ключей), `orm.run().fill().go()/sql()`, `single`-unwrap (`rows[0]` при first), `orm.raw()` passthrough, reshape на `PgAdapter`/`TransactionalPgAdapter` + пустой fallback в `createDebugAdapter`, run.test + integration compile-single, compile-performance (builder vs compiled ×12-55, warm-up, scaling where×N).
- **C1** — тег: `SqlFragment`, интерполяция, перенумерация, dedup, `toString()`, запрет строк-идентификаторов. — ✅ Done (`bf0e406`).
- **C2** — встраивание: select-embed (`.as()`, рендер проекции), order-embed (`.asc/.desc`), `array()` + `in(...)`. — ✅ Done (`5699286` select-embed, `8f954d7` перегрузки select, `59afe1c` array(), `59e11b4` order-embed).
- **C3** — docs/депрекация: `@deprecated` на `single/multi.toSql()`, `count().sql()`, `exists().sql()`; AGENTS.md (терминалы, Builder Reuse, правила); features.md F2 закрывается. — ✅ Done (`952a3a5`): `@deprecated` на `single/multi.toSql()`, на `.sql()` в `count()/exists()` (терминал `SqlPreviewTerminal`); остальное — план ниже.

**Зависимости:** A1 → (A2 → {B1 → B2 → {B3 → B4}, C1 → C2}) → C3. A обязателен первым; B и C идут после A2 и частично параллельны. **Отложено**: — (E `where(sql`...`)` `d578a5c`; F DML-выражения `204e91d`; G `ident()` `597622d` — все в main.)

---

## Файлы

**Core:**
- `src/orm/query-slots.ts` (**NEW**) — `QuerySlots`, `MultiQuerySlots` (B4), `BaseQuerySlots`, `ToDef` (маппинг SelectableField/AggregateField/ArrayField → слоты)
- `src/orm/builders/single.ts` — `compile<T>()`/`compile(S)`; `@deprecated` на `toSql()`
- `src/orm/builders/multi.ts` — `MultiSelectResult` + `compile<T>()`/`compile(S)` на `select()`; `@deprecated` на `toSql()` (C3)
- `src/orm/builders/single.ts` (`count`/`exists`) — `@deprecated` на `.sql()`
- `src/orm/orm.ts` — `raw()`
- `src/orm/slot.ts` (**NEW**) — `SlotMarker`, `slot()` (см. План 3)
- `src/orm/sql-fragment.ts` (**NEW**) — `SqlFragment`, тег `sql`, `array()`, `.as()/.asc/.desc` (см. План 3)
- `src/orm/field-builders/base-filter.ts`, `filters.ts` — generic `BaseFilter<TValue>`, `in(...ArrayValue/slot)`
- `src/orm/ast/selectable.ts` — `.array`-фантом (`ArrayField`)
- `src/orm/index.ts` — экспорт `QuerySlots`, `slot`, `sql`, `array`, `ident`

**sql-types:**
- `src/index.ts` — `HoleRef`, `SlotDefinition`, `CompiledQuery` (type-only)

**sql-pg:**
- `src/sql-generator.ts` — ветка `isHoleRef`; select/order kinds для фрагментов; `ArrayValue`; `slotOrder`; guard

**Тесты:**
- core: unit `query-slots.test.ts` (извлечение имён/типов, включая ArrayField и коммутацию `.array`/`.as`), `compiled-fill.test.ts` (порядок, валидация), тип-тесты (expect-error: eq-отклонение, имя не из Def, тип fill, `select([u.id.array])` запрет)
- sql-pg: `render-value` (слоты/$N), guard unfilled, select/order-embed, `array()` в `in()`
- integration: `test-project/test/orm/raw-slots.test.ts` — select с layers против PG; стабильность порядка при перестановке условий; повторный `fill`/переиспользование `CompiledQuery` в цикле
- multi: core `compile-multi.test.ts` (тип/рантайм), integration `test-project/test/orm/compile-multi.test.ts` (parity + слоты в join.on/include.where), perf-кейсы 10–16 в `compile-performance.test.ts`

---

## Связи

- Примитивы и контракт — `plans/builder-expression.md` (План 3)
- Открывает **F2** («нет raw() в ORM-слое») — `plans/features.md`