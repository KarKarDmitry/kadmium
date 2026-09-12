# Реиспользуемые скомпилированные запросы (QuerySlots + compiled + fill + orm.raw)

**Статус:** ⬜ Запланирован.
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

Для высоконагруженных запросов это аллокационный шум, который ощущается. Противодействие — цепочка из контекста проекта: **`clone() → toSql() → raw()`** = скомпилировать один раз, исполнять многократно. Паттерн доводится до примитива: `compiled()` на старте, `raw` в цикле — ноль прокси, ноль клонов, ноль рендера SQL, только `pool.query(text, params)`.

Параллельная проблема: **позиционные `$N` нельзя собирать руками**. SQL и параметры — неразрывная пара, выводимая из билдера. Решение — named-слоты (План 3) + `fill()` по ключам: порядок помнит компиляция, а не разработчик.

---

## QuerySlots — декларация слотов из модели

Назначение: **не писать тип слотов руками**. Типы выводятся из модели через уже существующие фантомы `SelectProxy` — это отличительная возможность, которой нет в других библиотеках.

```ts
const S = new QuerySlots(User)
  .push(u => [u.tenantId, u.createdAt.as('since')]);
// S.Def = { tenantId: number, since: Date }
```

Механика извлечения:

| Выражение в `push` | Тип | Имя слота | Значение |
|---|---|---|---|
| `u.tenantId` | `SelectableField<number, 'tenantId', undefined, _>` | `tenantId` (без `.as()`) | `TFieldType` |
| `u.createdAt.as('since')` | `SelectableField<Date, 'createdAt', 'since', _>` | `since` (`TAlias`) | `TFieldType` |
| `aggregates.count('*').as('cnt')` | `AggregateField<number> & { alias:'cnt' }` | `cnt` | `TResult` |

```ts
class QuerySlots<
  TModel extends { ['~shape']: Record<string, unknown> },
  Def extends Record<string, unknown> = {},
> {
  // чисто type-level: колбэк в runtime НЕ вызывается, только накапливает Def
  push<S extends readonly AnySelectable[]>(
    fn: (u: SelectProxy<TModel>, aggs: AggregateFunctions) => S,
  ): QuerySlots<TModel, Def & ToDef<S>>;

  // имя ограничено Def — «чужой» alias TS режет; значение типизировано Def[K]
  slot<K extends keyof Def & string>(k: K): SlotMarker<K, Def[K]>;
}
```

`push` может вызываться повторно для расширения наборов слотов. Вводить optional-слоты (`.req`/`.opt`) решили **не** вводить — все слоты обязательные.

---

## Терминалы и выполнение

### `builder.compiled()`

```ts
// плоский путь: тип руками, слоты — plain slot()
const a = app.orm.single(User)
  .where(t => t.tenantId.eq(slot('tenantId')))
  .compiled<{ tenantId: number }>();

// типизированный путь: fill проверен моделью через S
const b = app.orm.single(User)
  .where(t => t.tenantId.eq(S.slot('tenantId')))
  .compiled(S);
```

Имплементация: `sqb.clone()` → материализация select'ов → `adapter.toSql(sqb)` → `CompiledQuery`. `compiled(S)` в рантайме проверяет: каждый слот в AST ∈ `Def` (имена не придуманы на месте), и заодно собирает `slotOrder` из рендера.

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
- **`multi.compiled()` / слоты в `orm.query({...})`** — позже, вне скоупа.
- **Плоский `slot()`** держит `any`-фантом → пропускает eq-проверку по значению (осознанный компромисс; тип задаётся в `compiled<T>()`).
- Типы слотов из модели — ключевое отличие; eq-site проверка (`BaseFilter<TValue>`) — в Плане 3.

---

## Фазы (каждая ~300 строк, отдельный PR)

**PR A — тип-фундамент + адаптер**
- `BaseFilter<TValue>` generic-фантом; фильтры объявляют `V`; `eq(val: V | BaseFilter<V>)` — правка всех полей-фильтров.
- `SlotMarker`, `slot()`, `isHoleRef` (core); duck-typing в sql-pg.
- sql-types: `HoleRef`, `SlotDefinition`, `CompiledQuery` (type-only).
- `_renderValue` ветка `isHoleRef`; `toSql` → `slotOrder`; guard «unfilled slots» в `execute()`.
- Проверка: field-to-field сравнения в тестах — кросс-типовые (например `BaseFilter<number>` в `eq(string | BaseFilter<string>)`) после этого резонно запрещаются.

**PR B — QuerySlots + терминалы + orm.raw**
- `query-slots.ts` (type-level `push`/`slot`), `compiled<T>()`/`compiled(S)`, `fill` с валидацией, `OrmManager.raw`.
- Тесты: порядок `fill` при перестановке where-условий, лишний/недостающий ключ, integration против PG.

**PR C — `sql` ``-тег**
- Композиция фрагментов, перенумерация `$N`, dedup слотов, запрет строк-идентификаторов.
- Тесты: встраивание билдера (where/include) + слот снаружи, порядок/перенумерация, безопасность.

Порядок: **A обязателен первым** (на нём стоят B и C); B и C частично параллельны.

---

## Файлы

**Core:**
- `src/orm/query-slots.ts` (**NEW**) — `QuerySlots`, `ToDef` (маппинг SelectableField/AggregateField → слоты)
- `src/orm/builders/single.ts` — `compiled()` (плоский + `compiled(S)`)
- `src/orm/orm.ts` — `raw()`
- `src/orm/slot.ts` (**NEW**) — `SlotMarker`, `slot()` (см. План 3)
- `src/orm/field-builders/base-filter.ts`, `filters.ts` — generic `BaseFilter<TValue>`
- `src/orm/index.ts` — экспорт `QuerySlots`, `slot`, `sql`, `compiled`-контракт

**sql-types:**
- `src/index.ts` — `HoleRef`, `SlotDefinition`, `CompiledQuery`

**sql-pg:**
- `src/sql-generator.ts` — ветка `isHoleRef`, `slotOrder`, guard

**Тесты:**
- core: unit `query-slots.test.ts` (извлечение имён/типов), `compiled-fill.test.ts` (порядок, валидация), type-тесты (expect-error: eq-отклонение, имя не из Def, тип fill)
- sql-pg: `render-value` (слоты/$N), guard unfilled
- integration: `test-project/test/orm/raw-slots.test.ts` — select с layers против PG; стабильность порядка при перестановке условий; повторный `fill`/переиспользование `compiled` в цикле

---

## Связи

- Примитивы и контракт — `plans/builder-expression.md` (План 3)
- Открывает **F2** («нет raw() в ORM-слое») — `plans/features.md`