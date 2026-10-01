# Явный CRUD API — `orm.select / insert / insertMany / update / delete`

**Статус:** 🚧 PR1–PR7 закрыты (select, update, delete, insert, insertMany,
include — был уже готов, multi). PR8 (документация) — в работе.

**Суть:** один вход `orm.single(Model)` смешивает чтение и запись, из-за чего на
типах приходится городить сужение DML, а `create(data)` нарушает привычный
порядок аргументов. Разводим операции по разным входам: каждая операция —
самостоятельная поверхность со своим списком методов.

---

## Проблема

### 1. Типовое сужение вместо честных границ

`orm.single()` возвращает `DmlConfigHandle` = конфиг ∪ DML. Чтобы `.limit()`
(который sql-pg в DML не рендерит) не существовал на типах, приходится держать
**пять** интерфейсов и полиморфный `this`:

| Интерфейс              | Роль                                             |
| ---------------------- | ------------------------------------------------ |
| `SingleShared<L>`      | методы, нейтральные к DML                        |
| `SingleConfigHandle`   | вход `single()`                                  |
| `DmlConfigHandle`      | конфиг + DML                                     |
| `SingleOrderingBranch` | после `order()` — появляется `cursor()`          |
| `SingleCursorBranch`   | после `cursor()` — `offset/page/cursor` исчезают |

С `limit()` пришлось вынести тип возврата в параметр `L`, потому что
`limit(): this` нельзя переопределить потомком (TS2430). Это прямое следствие
смешения: **разделение входов удаляет все пять интерфейсов целиком**, а не
добавляет к ним шестой.

### 1a. Один билдер — один набор операций

Смешение видно и в самом классе: `SingleQueryBuilder` (18 КБ) несёт одновременно
`where/order/include`, `create/createMany/update/delete`, `count/exists` и
`compile`. Новая структура — файл на операцию, класс на операцию, тип входа
рядом с ним. Общего DML-родителя нет намеренно: `BaseQueryBuilder` даёт
`order/limit/offset`, а в UPDATE/DELETE они не рендерятся.

### 2. Молчаливое отбрасывание

`.limit(1).delete()` удалил бы все строки — метод доступен на типах, а sql-pg
его игнорирует. Сейчас это ловится рантайм-гардом в точке вызова. Новые входы
устраняют проблему структурно: у `delete()` вообще нет
`.order()/.limit()/.offset()`, компилятор не даст собрать такой запрос.

### 3. Порядок аргументов

`create(data)` — данные методом. Kysely/TypeORM/Prisma — аргументом:
`insert(User, data)`. Расхождение с индустриальным соглашением.

### 4. `select()` значит два разных вещи

На `single()` это проекция, которая рендерится как `RETURNING` в DML и как
`SELECT` в чтении. Одна метка, два смысла.

---

## Non-goals

- Не переписываем слой рендера: `sql-generator.ts`, `helpers.ts`, `guards.ts`,
  `where-expression.ts`, `query-proxies.ts`, `sqb.ts` — используются как есть.
- Не трогаем `query.ts` до PR5: `orm.query({...})` остаётся multi-входом.
- Не вводим DI-контейнер для прокси-фабрик.
- `compile()`/`run()`/`transaction()` — без изменений, новые билдеры их просто
  переиспользуют.

---

## API

### Чтение

```ts
orm.select(User)                      // только чтение
  .fields(t => [t.id, t.name])        // проекция; без неё — все поля
  .where(t => t.name.eq('Alice'))
  .order(t => [t.name.asc])
  .limit(10)
  .go();                              // row[]

orm.select(User).where(...).first();  // row | undefined
orm.select(User).where(...).count();  // SqlPreviewTerminal<number>
orm.select(User).where(...).exists(); // SqlPreviewTerminal<boolean>
orm.select(User).compile(S);          // слоты — без изменений
```

`count()`/`exists()` — не голые числа, а `SqlPreviewTerminal` с `.go()` и
`.sql()` (текущий контракт, `single.ts:426/443`). Их семантика неочевидна и
переносится как есть:

- `count()` считает **все** строки под фильтром — `limit/offset` не влияют
- `exists()` проверяет наличие любой строки — `offset` не влияет

Это не «упрощение API», а поведение, на которое могут опираться пользователи;
менять его в этом плане нельзя.

`fields()` вместо `select()`: на входе операция уже известна, слово «select»
избыточно, а `fields()` не конфликтует по смыслу с чтением в DML-контексте.

### Запись одного значения

```ts
orm
  .insert(User)
  .values({ name, email })
  .returning((t) => [t.id])
  .go(); // проекция

orm.insert(User).values(data).go(); // полная строка
```

`values()` — обязательный шаг, данные на входе не принимаются: `update` тоже
берёт данные шагом (`.set()`), и смешивать «данные аргументом» с «данные шагом»
между двумя write-входами — та же болезнь, что лечили в PR1–PR3. Имя метода
не выбрано случайно: `values()` — это VALUES, `set()` — это SET, оба ключевые
слова SQL, так что имя отвечает на вопрос «какая клауза будет в тексте».
Это же делает kysely (`.insertInto(T).values(data)`), чей порядок шагов мы
перенимаем.

Без `values()` доступен только `sql()`/броок; терминалы зовут
`_requireValues()` и кидают sync-throw — тем же приёмом, что `_requireSet()` в
`update.ts`.

### Upsert

```ts
orm
  .insert(User)
  .values({ name, email })
  .onConflict((t) => [t.email])
  .set({ name: sql`${t.name}` }) // DO UPDATE SET
  .returning((t) => [t.id])
  .go();

orm
  .insert(User)
  .values({ name, email })
  .onConflict((t) => [t.email])
  .doNothing() // DO NOTHING
  .go();
```

Порядок kysely-овский: сначала значения, дальше конфликтная клауза.
`set()` без `onConflict()` — рантайм-ошибка (сохраняем текущее поведение
`applySet`).

### Batch

```ts
orm
  .insertMany(User)
  .values([{ ... }, { ... }])
  .returning(t => [t.id])
  .go(); // проекция[]

orm
  .insertMany(User)
  .values(rows)
  .transaction(false)
  .onConflict(t => [t.email])
  .go();
```

Отдельный вход, а не перегрузка `insert`: список и одиночный объект неоднозначны
на типах, а у batch-пути своя транзакционная семантика
(`batchSize`/`needsTransaction` в `TransactionalPgAdapter`).

`{ transaction }` — тоже шаг, а не второй аргумент входа: иначе данные приходят
шагом, а опции аргументом, и единый стиль разваливается.

### Update / Delete

```ts
orm
  .update(User)
  .set({ age: 31 }) // set — терминал, данные обязательны
  .where((t) => t.name.eq('Alice'))
  .returning((t) => [t.id])
  .go(); // row[]

orm
  .delete(User)
  .where((t) => t.age.lt(18))
  .returning((t) => [t.id])
  .go(); // row[]
```

`where` не обязателен — продуктовое решение, не меняем (см. `plans/features.md`,
F-гарды).

### Include

```ts
orm
  .select(User)
  .include((t) => ({
    posts: t.posts.where((p) => p.published.eq(true)),
    author: t.author,
  }))
  .go();
```

Структурная форма (объект) вместо массива: у include появятся опции (`columns`,
`order`, `limit`), которые в массиве не выразить. Массив — частный случай
объекта из одного ключа.

---

## Структура: файл = операция

Каждая операция — отдельный файл с отдельным классом. Общего DML-родителя
**нет**: иначе `order/limit/offset` из `BaseQueryBuilder` пришлось бы тащить в
UPDATE/DELETE, где они не рендерятся, — и мы получили бы ровно то смешение,
которое разбираем.

```
packages/core/src/orm/builders/
├── select.ts        SelectQueryBuilder   → orm.select()
├── insert.ts        InsertBuilder        → orm.insert()
├── insert-many.ts   InsertManyBuilder    → orm.insertMany()
├── update.ts        UpdateQueryBuilder   → orm.update()
└── delete.ts        DeleteQueryBuilder   → orm.delete()
```

Общее не выносим в базовый класс — оно уже есть отдельными
**функциями**-сборщиками, и каждый билдер вызывает нужную через композицию.
Связь через вызов, а не через наследование: у `UpdateQueryBuilder` нет знания о
`DeleteQueryBuilder` и наоборот.

Тип входа (`SelectHandle`, `InsertHandle`, …) объявляется **в своём же файле**,
рядом с билдером. Отдельного `crud-handles.d.ts` нет — не создаём общий файл
типов для того, чтобы не смешивать методы.

## Карта переиспользования

Машинерия уже вынесена в отдельный слой — дублировать почти ничего не нужно.

| Модуль                           | Что берём                                                                              | Кто использует                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `builders/base-query-builder.ts` | `where/and/or/groupBy/order/limit/offset`, abstract-фабрики прокси, полиморфный `this` | `select.ts` — **наследованием, без дублирования**                               |
| `builders/write-finalizer.ts`    | `buildWriteFinalizer` — `where/returning/go/sql` для UPDATE/DELETE                     | `update.ts`, `delete.ts`                                                        |
| `builders/upsert-helpers.ts`     | `buildCreateFinalizer`, `applySet`, `applyReturning`                                   | `insert.ts`                                                                     |
| `builders/upsert-helpers.ts`     | `buildCreateManyFinalizer`                                                             | `insert-many.ts`                                                                |
| `builders/query-proxies.ts`      | `createFilterProxy`, `createSelectProxy`, `createOrderProxy`                           | `select.ts`; `createSelectProxy` — в `update`/`delete`/`insert` для `returning` |
| `builders/include-utils.ts`      | сборка include-конфига                                                                 | `select.ts`                                                                     |
| `builders/utils.ts`              | `buildDebugSql`                                                                        | все (`sql()`)                                                                   |
| `orm/guards.ts`                  | `assertDmlUpdate/Delete/Insert` и остальные                                            | defense-in-depth для JS/динамики                                                |
| `orm/sqb.ts`                     | `KadmiumSqb`, `orderToStep`                                                            | все                                                                             |
| `orm/sql-fragment.ts`            | `toSqlCondition`, `groupByToStep`                                                      | `select.ts`                                                                     |
| `sql-pg/src/*`                   | рендер, маппинг, helpers                                                               | не трогаем                                                                      |

**Что не переиспользуем:** `single.ts` (18 КБ), `query.ts` (14 КБ), `handles.ts`
(19 КБ) — остаются для legacy-пути, новые билдеры их не наследуют.

---

## Миграция

| Было                                | Стало                                 |
| ----------------------------------- | ------------------------------------- |
| `orm.single(User)`                  | `orm.select(User)`                    |
| `orm.single(User).create(d)`        | `orm.insert(User).values(d)`          |
| `orm.single(User).createMany(rows)` | `orm.insertMany(User).values(rows)`   |
| `orm.single(User).update(d)`        | `orm.update(User).set(d)`             |
| `orm.single(User).delete()`         | `orm.delete(User)`                    |
| `.select(t => [...])` (проекция)    | `.fields(t => [...])`                 |
| `.include(t => [t.posts])`          | `.include({ posts: true })`           |

`@deprecated` ставится в том же PR, который добавляет замену (иначе пользователь
останется без пути миграции):

- PR1: `SingleConfigHandle.select()` → `fields()` на новом `select.ts`
- PR2: `OrmManager.single()`, `SingleDml.update()`
- PR3: `SingleDml.delete()`
- PR4: `SingleDml.create()`
- PR5: `SingleDml.createMany()`

Цель — по завершении PR5 убрать пять DML-интерфейсов из `handles.ts`
(`DmlConfigHandle`, `SingleOrderingBranch`, `SingleCursorBranch` и хак с
`limit(): this` в параметре `L`), но **не в этом плане**: deprecated-объявления
остаются до отдельного решения об удалении (lib 0.1.0, breaking-цикл ещё не
наступил).

---

## Разбивка на PR

Каждый — аддитивный и самодостаточный: старое продолжает работать, новое покрыто
тестами. По одному файлу-операции на PR, чтобы ревью шло по операции целиком.

**PR1 — `select.ts` / `orm.select`**

- `SelectQueryBuilder extends BaseQueryBuilder` + тип `SelectHandle` в том же
  файле
- `fields()`, `go()`, `first()`, `count()`, `exists()`, `compile()`
- `OrmManager.select()`; экспорт в `orm/index.ts`
- `test-project/test/orm/select-api.test.ts`
- Deprecate `SingleConfigHandle.select()` → `fields()`

**PR2 — `update.ts` / `orm.update`**

- `UpdateQueryBuilder` поверх `buildWriteFinalizer` + тип `UpdateHandle`
- терминал `set(data)` → `where` → `returning` → `go`/`sql`
- `test-project/test/orm/update-api.test.ts`
- Deprecate `single()`, `SingleDml.update()`

**PR3 — `delete.ts` / `orm.delete`**

- `DeleteQueryBuilder` поверх того же `buildWriteFinalizer` + тип `DeleteHandle`
- `where` → `returning` → `go`/`sql`
- `test-project/test/orm/delete-api.test.ts`
- Deprecate `SingleDml.delete()`

**PR4 — `insert.ts` / `orm.insert`**

- `InsertBuilder` поверх `buildCreateFinalizer` + тип `InsertHandle`
- порядок `values → onConflict → set/doNothing → returning`; `values`
  обязателен (sync-throw `_requireValues()`), данные на входе не принимаются
- `test-project/test/orm/insert-api.test.ts`
- Deprecate `SingleDml.create()`

Реализовано: `dd03566`. Рефакторинг `buildConflictSteps` — общие
`onConflict/doNothing/set` вынесены из двух финализаторов в один хелпер.
Ограничение VALUES: коллбэк не может ссылаться на поля модели (`"User"."name"`
без FROM → PG 42P01), то же ограничение, что у RETURNING у INSERT.

**PR5 — `insert-many.ts` / `orm.insertMany`**

- `InsertManyBuilder` поверх `buildCreateManyFinalizer` + тип `InsertManyHandle`
- шаг `.transaction(bool)`, батчинг — без изменений в `sql-pg`
- **пустой батч бросает sync-throw `requires at least one row`** (`_requireValues`),
  а не возвращает заглушку. Отклонение от исходного плана: заглушка требовала
  рекурсии в трёх шагах и всё равно оставляла `go()` → `[]` no-op. Молчаливый
  пустой батч почти всегда означает потерю данных (забытый фильтр, неверный
  source), и `[]` это скрывал. Побочный плюс: `assertDmlInsert` в `values()`
  вызывается ДО проверки пустоты, поэтому `.limit(1).insertMany()` ловится гардом
- превью батча помечается `-- preview: first of N rows`: у батча нет одного sqb,
  `buildManyDebugSql` собирает одноразовый по ПЕРВОЙ строке, и молчаливое усечение
  вводит в заблуждение
- `test-project/test/orm/insert-many-api.test.ts`
- Deprecate `SingleDml.createMany()`

Реализовано: `8db8669`.

**PR6 — структурный `include()`**

- объектная форма + `select`/`order`/`limit` для include в `include-utils.ts`
- миграция массивной формы на новом `select.ts`

Закрыт без кода: структурный include уже был и в `single()`, и в `select()`, и
в `multi()`. `IncludeConfigValue` в `include-utils.ts:14` — объектная форма
(`true | { alias?, select?, where?, order?, limit?, include? }`), массивной нет
ни в одном входе, а `RelationProxy` — просто алиас на `IncludeConfig<TModel>`.
52 теста уже используют `.include({ ... })`. План описывал ключ `columns`, фактическое
имя — `select`.

**PR7 — multi**

- `orm.query({...}).fields()`, симметрия с `select`
- `MultiConfigHandle.select()` → `fields()`
- `multi.ts` → `query.ts`; `MultiSelectResult` → `MultiFieldsResult`,
  `MultiSelectProxy` → `MultiFieldsProxy` — без алиасов, ломающее изменение

Реализовано: `c14a3ee` + follow-up (переименование типов, ссылки в планах).

**PR8 — документация**

- `packages/core/AGENTS.md` — сделано в follow-up к PR7: таблица билдеров
  дополнена `InsertBuilder`/`InsertManyBuilder`, примеры include/compile
  переведены на структурный include и `fields()`, добавлены разделы по PR4/PR5/PR7
- `plans/typing.md` (DML-сужение заменяется раздельными входами) — осталось
- `README` в репозитории нет

## Верификация

```bash
npm run build
npm run check:type
npm run format:check
npm run lint
npm test --workspace packages/core
npm test --workspace packages/sql-pg
cd test-project && npm run db:up && npm run test:project
```

## Риски

1. **Типовая регрессия в PR2** — удаление `DmlConfigHandle` ломает чужие вызовы
   на этапе компиляции. Митигация: Deprecate, не удалять; удаление — отдельный
   PR.
2. **`Count`/`exists` на новом билдере** — реализация живёт в
   `single.ts:426/443`, возвращает `SqlPreviewTerminal` и имеет неочевидную
   семантику (count игнорирует пагинацию, exists — offset). Переносить вместе с
   ней, проверять на PG в PR1, а не тестом рендера.
3. **`include()` в DML** — у `.include()` в DML **нет гарда**: единственный
   ловец — сужение типов (см. `packages/core/AGENTS.md`). Новые входы include в
   DML не имеют вовсе, так что дыры нет; гард остаётся для legacy и не
   расширяется.
4. **`first()` в DML** — `first()` ставит `limit(1)`, что в UPDATE/DELETE не
   рендерится. На новых входах `first()` есть только у `select`.
5. **`where` в INSERT** — `assertDmlInsertNoWhere` (`guards.ts:204`) запрещает
   wheres в INSERT, они молча отбрасываются. У нового `insert`/`insertMany`
   метода `.where()` нет вовсе; это фиксируем как осознанное решение, а не как
   упущение.
