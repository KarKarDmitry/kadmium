# Builder Expressions — WHERE-выражения + cursor-пагинация

Два связанных плана: рефакторинг WHERE-композиции на выражения и cursor-based пагинация `.cursor()` (F5) на его базе.

---

## План 1: WHERE-выражения (breaking)

**Статус:** ✅ реализовано в `8c1bae7` (33 файла: AST, билдеры, рендер с минимальными скобками, тесты core/sql-pg/test-project; HAVING тоже переведён на шаги).

**Суть:** убираем авто-группировку из API. `where`/`and`/`or` — линейная последовательность шагов (без скобок и без авто-переносов), группы существуют только в выражениях `and(...)`/`or(...)`. Рендерер — минимальные скобки: parens ставятся только там, где их требует семантика.

### Модель AST

```ts
type WhereCondition = { alias?, field, column?, op, value };          // лист — без изменений
type WhereStep = { join: 'AND' | 'OR'; condition: WhereExpression };   // шаг
type WhereGroup = { elements: WhereStep[] };                           // единый узел
type WhereExpression = WhereCondition | WhereGroup;
```

`sqb.wheres` / `sqb.havings` — `WhereGroup` (плоская последовательность шагов). Группы из выражений — такие же `WhereGroup`, при вложенности выводятся в скобках.

### Семантика билдера (детерминированно, без групп на уровне API)

```
where(A).and(B).or(C)   → A AND B OR C              ≡ (A AND B) OR C   (PG precedence)
where(A).or(B).and(C)   → A OR B AND C              ≡ A OR (B AND C)
or(...)-style: первый join шага игнорируется
```

`.or()` больше не оборачивает предыдущий контекст (убираем `addOrCondition`). Вложенные where — **только выражениями**:

### Правило минимальных скобок (рендер)

- шаг выводится без скобок, если его «эффективный op» (все элементы одного join) совпадает с op контекста
- скобки — когда op ребёнка ≠ op родителя или ребёнок смешанный
- топ-уровень (`sqb.wheres`/`havings`) — всегда плоский, скобок нет, приоритет у PG

```
where(u => or(a, or(b, c)))    → a OR b OR c
where(u => and(a, and(b, c)))  → a AND b AND c
where(u => or(a, and(b, c)))   → a OR (b AND c)
where(u => or(a, b)).and(c)    → a OR b AND c
```

### API

```ts
import { and, or, WhereExpression } from '@karkardmitry/kadmium-core';

orm.single(User)
  .where(u => and(u.active.eq(true), u.name.eq('A')))
  .or(u => or(u.age.gt(30), u.id.eq(1)))   // (active AND name=A) OR (age>30 OR id=1)
  .go();
```

- `and(...exprs)`, `or(...exprs)` — `exprs: Array<WhereExpression | undefined>` → `WhereGroup | undefined`; `undefined` пропускается; пустой результат → `undefined` (шаг не пушится)
- `where`/`and`/`or` принимают `(t) => WhereExpression`
- `having`/`havingOr` — то же на havings
- `group()` / `havingGroup()` — удаляются; `where-helpers.ts` — удаляется целиком
- `` `groupAnd`/`groupOr` — НЕ вводим (при минимальных скобках не нужны; plain-группа с чужим op = тихая смена смысла)
- массивы `where(u => [or(), and()])` — НЕ вводим; последовательность = методы, вложенность = выражения
- `sql()` (raw-фрагменты, как в Drizzle) — отдельный этап, в этот срез не входит

### Файлы

**Core:**
- `src/orm/ast/where.ts` — `WhereStep`, `WhereGroup{elements}`, `WhereExpression`, `createWhereGroup()`
- `src/orm/where-expression.ts` (**NEW**) — `and()`/`or()`
- `src/orm/sqb.ts` — типы `wheres/havings`, `_cloneWhereGroup` под `elements`
- `src/orm/builders/single.ts` — `where/and/or/having/havingOr` → push шага + guard; удалить `group`/`havingGroup`, импорт `where-helpers`
- `src/orm/builders/multi.ts` — `where/and/or` → push шага + guard; убрать `addOrCondition`
- `src/orm/field-builders/relation.ts` — `where` → push шага + guard
- `src/orm/builders/include-utils.ts` — where-колбэк → `WhereExpression`
- `src/orm/builders/where-helpers.ts` — **удалить**
- `src/orm/types/proxy.d.ts` — `UpdateFinalizer.where` → `WhereExpression`
- `src/orm/types/includes.d.ts` — include `where?` → `WhereExpression`
- `src/orm/types/public-types.d.ts` — реэкспорт `WhereExpression`
- `src/orm/index.ts` — экспорт `and`, `or`, `WhereExpression`

**sql-pg:**
- `src/sql-generator.ts` — `_buildWhereGroupSql` под шаги + минимальные скобки; правки точек использования (subqueryWheres и т.п.)

**Тесты:**
- `packages/core/test/orm/where-expression.test.ts` (**NEW**) — комбинаторы: порядок, вложенность, skip, пусто
- `packages/core/test/orm/single-builder.test.ts` — удалить блоки `group`/`havingGroup`, переписать где/and/or под `elements`
- `packages/core/test/orm/where-helpers.test.ts` — **удалить**
- `packages/core/test/orm/multi-builder.test.ts` — адаптация под форму
- `test-project/test/orm/where.test.ts` — `group()`-тест → выражение; тест и+или (`A AND B OR C`) — без изменений; добавить детерминизм `.where(A).or(B).and(C)` → `A OR (B AND C)`

**Документация:**
- `packages/core/AGENTS.md` — правило: builder-методы = линейная последовательность; вложенные where — выражениями
- `plans/features.md` — упомянуть предпосылку F5

---

## План 2: F5 — cursor-based пагинация `.cursor()` (после Плана 1)

**Статус:** ✅ реализовано: План 1 — `8c1bae7`, `.cursor()` (План 2) — `0dcc309`. F5 закрыт.

**Суть:** keyset-пагинация. `.cursor(fn)` — sugar над where: runtime-ошибка, если нет `order()`; проверка полей курсора ⊆ полей order (мягко или строго — решено: строгое требование только на наличие `order()`).

### API

```ts
orm.single(User)
  .order(u => [u.age.asc, u.id.desc])
  .cursor(u => or(u.age.gt(30), and(u.age.eq(30), u.id.lt(500))))
  .limit(10)
  .go();
// → WHERE ("u"."age" > $1 OR ("u"."age" = $1 AND "u"."id" < $2))
//    ORDER BY "u"."age" ASC, "u"."id" DESC LIMIT $3
```

- `cursor(fn: (t) => WhereExpression | undefined)` — то же, что `where(fn)`, но: throw, если `sqb.orders.length === 0`; throw при повторном `cursor()`; throw, если `offset()` уже задан
- направление задаётся оператором (`gt`/`lt` — только числовые/датовые поля), инклюзивность — `gte/lte/eq`; OR-цепочка `(k1 OP1 v1) OR (k1 = v1 AND k2 OP2 v2)` пишется выражениями
- `before()` — отдельным этапом (нужен реверс результата); opaque-токен — вне core (API-слой)
- конфликт с `offset()`/`page()` — ошибка (обе стороны guard'ов); `limit()` остаётся отдельным; multi — вне scope MVP
- NULL в ключах — не поддерживается (NOT NULL — документируется)

### AST

Курсор — **отдельный узел `sqb.cursor: WhereGroup`** (не шаги в `wheres`): состояние выводится из данных (`cursor.elements.length > 0`), флага нет. Рендер — отдельный AND-член в WHERE:

- курсор ВСЕГДА в скобках: `WHERE (…) AND (cursor)`
- главная where-группа оборачивается в скобки, только если содержит OR-шаг (`A OR B` + AND-курсор иначе перехватит хвост)
- параметры: wheres → cursor (порядок в тексте)

### Файлы (после Плана 1)

- `src/orm/builders/single.ts` — метод `cursor()` (+ guard'ы в `offset()/page()`)
- `src/orm/sqb.ts` — `cursor: WhereGroup`, deep-clone
- `packages/sql-types/src/index.ts` — контракт: `ReadonlySqb.cursor: WhereGroup`
- `packages/sql-pg/src/sql-generator.ts` — рендер курсора в селект-пути (см. AST)
- тесты: `test/orm/single-builder.test.ts` (guard'ы), `test/orm/sqb.test.ts` (clone), `test/sql-generator/cursor.test.ts` (6 случаев), интерактивный `test-project/test/orm/pagination.test.ts` (сид 10 пользователей, стабильность при вставке, DESC, multi-key, gte)
- `plans/features.md` — секция F5 закрывается

---

## План 3: `sql()` / `sql` ``-фрагменты + `slot()`-параметры (raw-выражения)

**Статус:** ⬜ Запланирован (отложен до отдельного этапа; оценка сложности — в `plans/compiled-queries.md`). Разблокирует отложенное из Плана 1: «`sql()` (raw-фрагменты, как в Drizzle) — отдельный этап, в этот срез не входит».

Слот-маркер уже частично реализован: `SlotMarker`/`slot()`/`isHoleRef` + рендер `slotOrder` (A2, `528f9f1`) — см. строки A2/B1/B2 в `compiled-queries.md`. Осталось: `SqlFragment`/тег (C1), встраивание + `array()` (C2), депрекация `toSql` (C3).

**Что такое `sql` (позиционирование, снимает смешение «компилятор vs SQL»):**
```
Модель-путь:  Model → builder → AST → adapter.toSql → {text, values}   ┐
Raw-путь:     sql`...` (тег) → SqlFragment                              ┘→ .compile() → CompiledQuery → .fill({...}) → orm.raw(...)
                                     единый компилятор, оба пути сходятся
```
- **`sql`** — *фабрика raw-фрагментов*: тег возвращает `SqlFragment` — «сырое выражение», которое модель-путь не умеет. Это **не компилятор и не исполняемый SQL**, а композируемая часть.
- **`.compile()`** — *компилятор* (действие, глагол): общий терминал фрагмента и билдера → `CompiledQuery` (порядок плейсхолдеров зафиксирован).
- **`.fill()`** — подстановка значений по слотам; **`orm.raw(...)`** — исполнение. Оба пути сходятся в `CompiledQuery`.

**Суть:** два примитива:
- **`slot(name)`** — маркер «параметр по имени» в значении `WhereCondition` или в интерполяции тега. Позиция запоминается на компиляции, значение подаётся позже по ключу.
- **`sql` ``** — композитор SQL-фрагментов (как Drizzle): значения, слоты, вложенные фрагменты/билдеры; автоперенумерация `$N` и dedup слотов по имени.

**Справочник всех позиций применения (закреплено по итогам обсуждения):**

| # | Использование | Пример | Статус |
|---|---|---|---|
| A — исполнение | 1. Полный raw-запрос | `orm.raw(sql`SELECT ... WHERE active`).go()` | ✅ v1 |
| | 2. + слоты → горячий цикл | `sql`...${S.slot('tenantId')}`.compile(S).fill({...})` | ✅ v1 |
| B — композиция | 3. Фрагмент во фрагменте (перенумерация $N) | `sql`SELECT ${inner} + ${tax} ...`` | ✅ v1 |
| | 4. Билдер во фрагменте (CTE/EXISTS-подзапрос) | `sql`WITH s AS (${scoped}) ...`` | ✅ v1 |
| C — проекция | 5. Функции/выражения как колонки | `select(t => [t.id, sql<number>`EXTRACT(YEAR FROM ${t.createdAt})`.as('year')])` | ✅ v1 (гарантировано) |
| D — порядок | 6. ORDER/GROUP BY по выражению | `.order(t => [sql`similarity(...)`.desc, t.createdAt.asc])` | ✅ v1 |
| E — предикаты | 7. `where(sql`...`)` / raw-условия | — | ⛔ сознательно НЕ вводим (рвёт композицию Плана 1; чинится топ-уровнем + слотами) |
| F — DML | 8. `set({ col: sql`views + 1` })`, `create({ at: sql`now()` })`, onConflict SET | — | 🔵 отдельным этапом |
| G — идентификаторы | 9. Динамические имена | `sql`SELECT ${ident('col')} FROM ${ident('tbl')}`` | 🔵 маркер `ident()` + `assertSqlIdentifier` (S10); 🔵 или позже |
| H — вспомогательное | 10. `sql<T>`, `.as()`, `.asc/.desc`, `toString()`, `array([...])` | — | ✅ v1 (toString — debug-only) |

### Слой слот-маркера

```ts
// repository: runtime-класс в Core
class SlotMarker<K extends string = string, V = unknown> extends BaseFilter<V> {
  readonly kind = 'slot' as const;
  constructor(public readonly slotName: K) { super(/* ... */); }
}
```

- **Плоский** `slot(name)` — `SlotMarker<name, any>`: проходит `eq` любого фильтра, тип значения задаётся в `compile<T>()` вручную.
- **Типизированный** `S.slot(name)` — `SlotMarker<name, Def[name]>` из `QuerySlots` (см. compiled-queries.md): имя ограничено `keyof Def`, значение типа выведено из модели.
- **eq-site проверка** — `BaseFilter<TValue>` становится generic (фантом), фильтры объявляют свой `V`:
  ```ts
  class StringFilter extends BaseFilter<string> { eq(val: string | BaseFilter<string>): WhereCondition }
  class NumberFilter extends BaseFilter<number> { ... }
  ```
  `tenantId.eq(S.slot('since'))` при `since: Date` → `BaseFilter<Date>` не подходит к `number | BaseFilter<number>` → **тип-ошибка у места использования**. `any`-фантом плоского `slot()` осознанно ломает эту проверку — компромисс за удобство.

### Рендер (sql-pg)

- `_renderValue` (sql-generator.ts): ветка `isHoleRef(value)` → `$N`, маркер кладётся в `values`, позиция пишется в slotOrder:
  ```
  values.push(marker); return `$${paramIndex.p++}`;  + slotOrder.append({ name, index })
  ```
- Duck-typing без импорта из Core (порядок: `core → sql-types ← sql-pg`, sql-pg не импортирует core): `isHoleRef(v) = v && typeof v === 'object' && (v as any).kind === 'slot'`.
- `toSql()` возвращает `{ text, values, slotOrder }` (`slotOrder` — dedup по имени, индекс первого вхождения).
- **Guard в `execute()`**: слот-маркер остался в `values` без `fill` → throw «unfilled slots: [names]».

### `sql` ``-тег

```ts
const q = sql`
  WITH scoped AS (${base})                    // вложенный билдер/фрагмент → text+values+slotOrder
  SELECT * FROM scoped
  WHERE scoped.created_at > ${S.slot('since')}`;  // SlotMarker → именованный слот
  // примитив/значение → literal-параметр ($N)
```

**Вход — четыре вида частей интерполяции:**

| Часть | Поведение |
|---|---|
| примитив (string/number/boolean/Date/null) | → `$N` + параметр; **никогда** не инлайн |
| `S.slot('x')` / `slot('x')` | → именованный слот; позиция → slotOrder |
| `SqlFragment` / билдер / `CompiledQuery` | → вливание text+values+slotOrder + перенумерация `$N`; dedup слотов по имени |
| строка-идентификатор | → **запрещена** как значение; идентификаторы — только валидируемый маркер (`ident()` + `assertSqlIdentifier`, S10) |

- **Перенумерация `$N`**: при встраивании фрагмента с `M` параметрами идёт сдвиг на текущий счётчик (то же для маркеров). Порядок `slotOrder` — фактический порядок плейсхолдеров в итоговом тексте.
- **Dedup**: слот-имя, встреченное в нескольких местах ⇒ один параметр; `fill` заменяет маркер во всех вхождениях (семантически одно значение).
- **`undefined`** в интерполяции → ошибка с указанием позиции (не тихая потеря).
- **Безопасность (инъекции — на библиотеке)**: runtime-значения в теге **всегда** становятся параметрами (`$N`), текст SQL из них не собирается в принципе — разработчик не может заинжектить через значение, это гарантия библиотеки. Запрет касается только **идентификаторов**: передача строки-имени через тег = ошибка; путь строк в текст SQL один — валидируемый маркер `ident()`.
- **Debug-превью**: `SqlFragment.toString()` — инлайн значений для логов, отдельно, debug-only (в проде не использовать).

**Встраивание в select/order (строки C/D таблицы):**
- `sql<T>...`` + `.as(alias)` — обёртка в `SqlSelectable` (алиас **обязателен** для маппинга результата); принимается select-proxy'ем; рендер — отдельный kind в select-списке.
- `sql`...``.asc/.desc` — сортировка по выражению; принимается order-proxy'ем.
- Массивы в теге — **НЕ раскрываются** (см. `array()` ниже); подзапросы — только явным встраиванием билдера.

### `array([...])` — массив-значение (companion-выражение, не тег)

Массивы вынесены из тега в отдельное value-выражение — параметр как полноправное значение:

```ts
t.id.in(array([1, 2, 3]))      // IN ($1); params: [[1,2,3]] — node-pg сериализует JS-массив
```

- `array(...)` → маркер `ArrayValue<T>` → рендерится как очередной параметр.
- `.in()` расширяется: `in(vals: T[] | ArrayValue<T> | BaseFilter<T>)` — принимает и литерал, и `array(...)`, и слот (см. ниже `ArrayField`), т.е. `t.id.in(S.slot('ids'))`.
- Объекты/даты в любом value-слое сериализуются единым value-encoder адаптера (не `String()`).

### Контракт (sql-types, type-only)

```ts
interface HoleRef { kind: 'slot'; slotName: string }
interface SlotDefinition { name: string; index: number }
interface CompiledQuery<TSlots = Record<string, never>> {
  text: string;
  values: (unknown | HoleRef)[];
  slotOrder: SlotDefinition[];
  fill(input: TSlots): { text: string; params: unknown[] };
}
```

### Пример

```ts
const base = app.orm.single(User)
  .where(t => t.tenantId.eq(S.slot('tenantId')))
  .include(t => [t.posts]);

const compiled = sql`
  WITH scoped AS (${base})
  SELECT * FROM scoped WHERE scoped.created_at > ${S.slot('since')}
`.compile(S);
// slotOrder: [{ tenantId, index:0 }, { since, index:1 }] — по фактическому порядку

await app.orm.raw(...compiled.fill({ tenantId, since })).go();
```

### Файлы

- `packages/sql-types/src/index.ts` — `HoleRef`, `SlotDefinition`, `CompiledQuery` (type-only, пакет без runtime)
- `packages/core/src/orm/slot.ts` (**NEW**) — `SlotMarker`, `slot()`, `isHoleRef`
- `packages/core/src/orm/field-builders/base-filter.ts` — `BaseFilter<TValue>` (generic-фантом)
- `packages/core/src/orm/field-builders/filters.ts` — фильтры объявляют `V`; `eq(val: V | BaseFilter<V>)`; `in(vals: T[] | ArrayValue<T> | BaseFilter<T>)`
- `packages/core/src/orm/ast/selectable.ts` — `.array`-фантом (`ArrayField`) на `SelectableField`
- `packages/core/src/orm/sql-fragment.ts` (**NEW**) — `SqlFragment`, тег `sql`, `ident()`, `array()`, `.as()/.asc/.desc`, `toString()`
- `packages/core/src/orm/types/proxy.d.ts` — select/order-прокси принимают `SqlSelectable`/`SqlOrder`; `ArrayField` исключён из select
- `packages/sql-pg/src/sql-generator.ts` — ветка `isHoleRef`; select/order-список: новые kinds; `ArrayValue`
- `packages/core/src/orm/index.ts` — публичный экспорт `sql`, `slot`, `array`, `ident`

### Тесты

- рендер `$N` при нескольких слотах + нумерация после обычных параметров
- dedup слотов по имени (один параметр, `fill` заменяет все вхождения)
- guard: `execute()`/`go()` с незаполненным слотом → throw
- тип: eq-отклонение (`BaseFilter<Date>` vs `BaseFilter<number>`) — expect-error
- тег: встраивание билдера с where/include + слот снаружи; перенумерация; строка-идентификатор через тег → запрет
- `array([...])` в `in()` → один массив-параметр; `in(S.slot('ids'))` (ArrayField) — тип и значение
- select-embed: `sql<T>...`.as()` рендерится с алиасом, маппится; без `.as()` → тип-ошибка
- order-embed: `sql`...`.desc` + строка-идентификатор в order → запрет

### Связи

- Исполнение и типизация (QuerySlots, `.compile()`, `.fill()`, `orm.raw`, фазы PR, оценка сложности) — `plans/compiled-queries.md`
- Открывает **F2** («нет raw() в ORM-слое») — `plans/features.md`

---