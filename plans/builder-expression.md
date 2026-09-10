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