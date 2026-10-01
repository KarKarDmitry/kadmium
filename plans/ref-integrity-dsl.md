# Расширение DSL ссылочных данных — `onDelete` / `onUpdate` в `f.ref`

**Статус:** 📋 решения приняты, реализация не начата. PR1 — DSL.

**Суть:** `f.ref` сегодня умеет только геометрию связи (`target`/`inverse`/`fk`/
`oneToOne`/`manyToOne`) и ничего не говорит о том, что происходит с детьми при
удалении родителя. Referential-действие задаётся только вручную через
`DbForeignKey` в обход DSL. Разрыв заметен в `test-project`: любая новая связь
родитель→ребёнок даёт FK с `NO ACTION`, и удаление родителя падает.

---

## Проблема

### 1. В DSL нет referential-действий

Цепочка `Model → IR → diff → DDL` обрывается на первом звене:

| Слой | Что есть про `ON DELETE` |
|------|---------------------------|
| `ReferenceFieldBuilder` (`model/fields/ref.ts`) | ничего — только `target`/`inverse`/`fk`/`oneToOne`/`manyToOne` |
| `ReferenceField` (`model/types/ref.d.ts`) | ничего — `ref`, `relation`, `inverse`, `foreignKey` |
| `FieldIR` (`ir/index.ts`) | ничего — `ref`, `relation`, `inverse`, `foreignKey`, `sourceModel` |
| `expectedForeignKeys()` (`sql-pg/src/diff/types.ts:277`) | **хардкод** `onDelete: 'NO ACTION'`, `onUpdate: 'NO ACTION'` |

`DbForeignKey.onDelete/onUpdate` в sql-types знают все пять действий
(`NO ACTION | CASCADE | SET NULL | RESTRICT | SET DEFAULT`), и
`assertReferentialAction()` в `ddl-validate.ts:21` их валидирует — но достичь
этого богатства можно лишь ручным `applyDiff`, минуя DSL. Полезная логика в
адаптере есть, вход в неё отсутствует.

Следствие видно в тестах PR3: `delete-api.test.ts` вручную сносит комментарии и
посты перед удалением пользователя (`clearDependents`). Это не обход каскада —
это вынужденная последовательность, которую пользователь обязан знать из
документации, потому что язык её не выражает.

### 2. Нельзя сказать «не ссылайся больше»

Обратная половина проблемы. Для `CASCADE` (удалить родителя → удалить детей) и
`NO ACTION` (запретить) достаточно текущего молчания. А `SET NULL` требует
выразить ещё одно намерение: **колонка обязана быть nullable**. Сегодня
`nullable` задаётся независимо (`f.ref...notNull()` / дефолт `nullable: true` в
`StandartFieldBuilder`), поэтому `onDelete: 'set null'` на `notNull()`-колонке —
это заведомо падающая миграция: Postgres отвергает такой FK при создании
(`column "x" must be nullable to use SET NULL`), то есть ошибка всплывает поздно
и вне контекста — в момент `ALTER TABLE`.

### 3. `no action` и `restrict` для пользователя неразличимы

Оба запрещают удаление родителя при живых детях, различаясь лишь таймингом
проверки. В DSL они сейчас не выразимы вовсе. Отдельно: смена PK родителя по
умолчанию ломает FK, и `onUpdate` тоже молчит.

---

## Решение

### DSL

```typescript
class Comment extends Model {
  post = f.ref.target(Post, 'comments').onDelete('cascade');
  user = f.ref.target(User, 'comments').onDelete('set null');
}

class Post extends Model {
  author = f.ref.target(User, 'posts').onDelete('cascade');
  // по умолчанию onUpdate — 'no action'
}
```

Аргумент — **union в нижнем регистре**:

```ts
type ReferentialActionInput =
  | 'no action'
  | 'cascade'
  | 'set null'
  | 'restrict'
  | 'set default';
```

Нижний регистр — потому что это то, что читается в модели. `'CASCADE'` и
`'cascde'` отвергаются компилятором, импортировать тип в модель не нужно: он
реэкспортируется из корня пакета. Нормализация в runtime остаётся только для JS
и динамики.

### Почему не сахар `.cascade()` и не связка `onAction`

**Сахар.** Именованное действие как настоящий метод требует либо второго словаря
(`.cascade().onUpdate('cascade')`), либо плоских `.onUpdateCascade()` — десять
методов на матрицу 5×2, работающих наполовину. `onDelete`/`onUpdate` покрывают
её двумя методами. И `.restrict` на ref-поле читается как «что ограничивает?».

**Связка `onAction`.** События разные, а значения типично противоположны:
`ON DELETE CASCADE` (удалить родителя → удалить детей) против `ON UPDATE
RESTRICT`/`NO ACTION` (не дать сдвинуть PK под живыми детьми). Связывание ставит
одно значение по обе стороны, а правильные почти всегда разные — и правильная
пара `onDelete('cascade') + onUpdate('restrict')` через `onAction` не выражается
без дополнительных вызовов. Хуже: `ON UPDATE CASCADE` означает, что
`orm.update(User).set({ id })` молча перепишет FK-колонку у всех детей в одной
транзакции. PK в kadmium мутируемый (`immutable()` в DSL нет), так что это не
теоретический риск.

### Каноническая форма живёт в IR, нижняя — на границе модели

| Слой | Форма | Где |
|------|-------|-----|
| DSL | `ReferentialActionInput` (нижний регистр) | `ReferenceField.onDelete` |
| IR | `ReferentialAction` (верхний регистр) | `FieldIR.onDelete` |
| DDL | `DbForeignKey['onDelete']` | тот же тип |

`ReferentialAction` выносится в `sql-types` и заменяет инлайн-union в
`DbForeignKey` (`sql-types/src/index.ts:347`). Обе зависимости уже есть, ядро
`core → sql-types ← sql-pg`.

**Маппинга в sql-pg нет.** `ReferentialActionInput` и `toReferentialAction()`
живут в `ir/index.ts` (единственный файл, которому положено знать обе формы);
`model/types/ref.d.ts` импортирует тип оттуда — направление `model → ir` уже
существует (`compile.ts:4`), обратного импорта не появляется. `expectedForeignKeys`
становится `onDelete: f.onDelete ?? 'NO ACTION'` — те же строки, что сейчас,
только из поля.

### Инверсия не транслируется

`Post.author.onDelete('cascade')` означает «при удалении Post удалить Comment»
(если действие стоит на `Comment.post`). На стороне `User.posts` — обратной
связи — действие не задаётся: FK живёт на стороне владельца, и там, где
объявлено ref-поле, его и пишут. На `User` вообще нет ref-полей, писать нечего и
терять нечего: имя `'posts'` в `.target(User, 'posts')` — только имя поля для
`include`, ни колонки, ни FK оно не создаёт.

**«Владелец» определяется не через `relation`, а через `!sourceModel`** — так
же, как в `irToColumns` (`types.ts:219`) и `expectedForeignKeys` (`types.ts:262`).
В `test-project/src/models/comment.ts:8` стоит `f.ref.target(Post, 'comments')`
**без** `.manyToOne()`, а дефолт `relation` — `'one-to-many'` (`ref.ts:8`),
хотя поле физически владеет колонкой. `relation` про владение не говорит
ничего.

Поэтому действие копируется в IR **только** для прямых полей — одна правка в
`compile.ts:56`. Виртуальные inverse-ref'ы (`compile.ts:67` и `compile.ts:98`)
не получают `onDelete`: они отбрасываются обоими потребителями по `sourceModel`,
туда действие попасть не может, а `ModelRelation` менять незачем.

Цепочка `User → Post → Comment` с двумя каскадами работает транзитивно силами
самого Postgres. Порядок операций в диффе безразличен — все FK применяются в
одной транзакции (`applyDiffTransactional`).

### Валидация — на билдере, не на рендере

Обе проверки в `$build()` (`model/fields/ref.ts`), а не при миграции: ошибка
указывает строку модели, а не `ALTER TABLE` в проде.

1. Значение не из пяти → throw. TS отсекает раньше, guard нужен для JS.
2. `onDelete('set null')` + `notNull()` → throw с указанием причины.

`onUpdate('set null')` проверяется так же: `SET NULL` на `ON UPDATE` требует
nullable не меньше, чем на `ON DELETE`.

`set default` на `notNull()` **не** проверяем — Postgres создаст ограничение, оно
упадёт только в момент удаления родителя. Это редкий осознанный случай.

`assertReferentialAction()` в sql-pg остаётся defense-in-depth для ручного
`applyDiff`, где валидации модели нет.

### Миграции — через diff, а не через отдельный путь

`expectedForeignKeys()` начинает читать `f.onDelete` / `f.onUpdate`. Дефолт
`'NO ACTION'` сохраняет поведение всех существующих моделей байт-в-байт:
миграции не появятся там, где действие не написано.

Действующая логика `computeDiff` **не ловит изменение действия** — она
сравнивает только `fk.name` (`compute.ts:196`), поэтому смена `no action` →
`cascade` на существующей паре таблиц молча проигнорировалась бы. Нужен
`AlterForeignKeyOp`.

**Отдельная операция, а не `drop` + `add`.** Причина — семантика health-check:
`diffToHealth` (`diff/index.ts:74`) заводит `addedForeignKeys > 0` как «foreign
key(s) missing», и `db check` покраснел бы на исправной схеме. Отсюда же
собственный счётчик `alteredForeignKeys`, своя строка в health и в сводке
`dbPush`.

`DROP` идёт перед `ADD` внутри одного op, обе статменты в одной транзакции —
схема не остаётся без FK между шагами. Рендер — через существующие
`dropForeignKeySql` + `addForeignKeySql`, нового SQL-строителя не появляется.

---

## Разбивка на PR

Каждый PR — bisectable: собирается, проходит гейты и тесты сам по себе.

### PR1 — DSL: `onDelete`/`onUpdate` в `ReferenceFieldBuilder`

- `ReferentialActionInput` в `ir/index.ts` — только форма, которую пишет модель;
  каноническая форма в этом PR ещё не нужна
- `ReferenceFieldBuilder.onDelete(action)` / `.onUpdate(action)`, приватные
  поля, проброс в `$build()`
- `ReferenceField.onDelete`/`onUpdate` в `model/types/ref.d.ts`
- Две проверки в `$build()`: значение не из пяти, `set null` + `notNull()`
- Тесты: `packages/core/test/model/fields/ref.test.ts` — пять значений,
  дефолты (поля отсутствуют), цепочка с `target`/`fk`/`inverse`, `set null` +
  `notNull()` бросает в любом порядке вызовов, `set default` + `notNull()`
  разрешён, повторный вызов — последний побеждает

**Не трогаем** IR-поля, diff, DDL: билдер производит поле, которое пока никто не
читает. Законченный вертикальный срез, который коммитится, даже если следующие
PR задержатся. `ReferentialActionInput` локальный — core от этого PR не зависит
от нового контракта sql-types.

### PR2 — контракт: `ReferentialAction` и проброс в `FieldIR`

- `ReferentialAction` в `sql-types/src/index.ts`, `DbForeignKey` ссылается на
  него вместо инлайн-union
- `toReferentialAction()` в `ir/index.ts` — единственный маппинг нижней формы в
  каноническую, `ir/index.ts` реэкспортирует `ReferentialAction`
- `FieldIR.onDelete`/`onUpdate`
- `compile.ts:56` — копирование в `base.onDelete`/`base.onUpdate` для прямых
  полей. **Одно место**, не три: inverse-ref'ы отбрасываются по `sourceModel`
- `ModelRelation` не меняется
- Тесты: `packages/core/test/model/compile.test.ts` — прямое поле с
  uppercase-формой, поле без действий, обратная связь без действия, наследование
  от родителя, one-to-one vs one-to-many

Порядок сборки (`sql-types → sql-pg → core`) уже верный, но после правки
`sql-types/src` нужен `npm run build` до `check:type`: пакеты — джункшены, типы
core резолвятся из `sql-types/dist/index.d.ts`.

### PR3 — sql-pg: чтение действия

- `expectedForeignKeys()` читает `f.onDelete ?? 'NO ACTION'` / `f.onUpdate ??
  'NO ACTION'`; `IrField` получает два необязательных поля
- Тесты: `packages/sql-pg/test/diff/types.test.ts` — действие из поля, дефолт
  `NO ACTION`, passthrough всех пяти (сейчас `expectedForeignKeys` проверяет
  только имя/колонки)

### PR4 — diff: `AlterForeignKeyOp`

- `AlterForeignKeyOp { type, tableName, fkName, oldFk, newFk }` в
  `sql-pg/src/diff/types.ts`, добавление в `DiffOp` и в реэкспорт `diff/index.ts`
- `summary.alteredForeignKeys`
- `compute.ts`: расхождение по `onDelete`/`onUpdate`/`refTable`/`columns`/
  `refColumns` при совпавшем имени даёт `alter-foreign-key` вместо отсутствия
  операции. Имя FK зависит только от таблицы и колонки, поэтому смена действия
  его не затрагивает и соседние FK не шевелятся
- `diffToHealth()` — своя строка issue
- `apply.ts` `opToString` — `ALTER FK <name> on <table>: ON DELETE a → b`
  (и `ON UPDATE` тоже, если изменилось)
- Тесты: `packages/sql-pg/test/diff/{types,compute,health}.test.ts` —
  `alter-foreign-key` на смене действия, отсутствие op при совпадении, `add`
  при отсутствии FK, `drop` при лишнем, оба счётчика

### PR5 — render, apply, validate

- `render.ts`: op возвращает две статменты — `dropForeignKeySql`, затем
  `addForeignKeySql(newFk)`. `renderSql` джойнит операции через `\n\n`
  (`render.ts:51`), поэтому многострочный возврат из `opToSql` допустим
- `apply.ts` `executeOp`: `alter-foreign-key` → `dropForeignKey` + `addForeignKey`
- `ddl-validate.ts` `assertDiffOpSqlSafe`: валидация **обоих** FK
- Тесты: `render.test.ts` (порядок и текст обеих статмент), `apply.test.ts`
  (порядок вызовов ddl), `ddl-validate.test.ts` (отравленный `newFk` бросает)

### PR6 — интеграция

- Модели `test-project`: `Post.author` → `cascade`, `Comment.post` → `cascade`,
  `Comment.user` → `set null` (колонка nullable по умолчанию)
- `test-project/test/ddl-fk.test.ts`: миграция на существующей базе меняет
  действие — проверка через `information_schema.referential_constraints`, а не
  только текст SQL; `cascade` удаляет детей; `set null` обнуляет; `no action` по
  прежнему блокирует удаление родителя
- `delete-api.test.ts`: `clearDependents()` снимается вместе с докблоком,
  объясняющим его вынужденность
- `RESTRICT` vs `NO ACTION` проверяется **на уровне DDL**: разница в Postgres
  наблюдаема только через deferral или нечувствительную к регистру коллацию, и
  ни того, ни другого в kadmium нет. `render.test.ts:80` расширяется литералами

### PR7 — документация

- `packages/core/AGENTS.md`: форма `.onDelete()`, правило «действие на владельце
  колонки», цепочка `User → Post → Comment`
- `packages/sql-pg/AGENTS.md`: `expectedForeignKeys` больше не хардкодит,
  `alter-foreign-key` в diff, сравнение по действию
- Докблоки в `delete-api.test.ts` и `insert-api.test.ts`, где описана граница
  «FK всегда NO ACTION»
- Статус этого плана

### Вне этого цикла

**`one-to-one` и `UNIQUE`.** `one-to-one` на стороне владельца требует `UNIQUE`
на FK-колонке, иначе это `many-to-one` в БД при заявленном `one-to-one` в DSL.
`expectedIndexes()` создаёт индекс для любого ref, но `isUnique` берётся из
`f.unique`, а не из `relation === 'one-to-one'` (`types.ts:248`). Расхождение
уже есть и без `onDelete`; здесь оно лишь становится заметнее. Отдельный PR,
когда тесты покажут реальные проблемы.

---

## Принятые решения

1. **Форма API:** `onDelete(action)` / `onUpdate(action)`, аргумент — union в
   нижнем регистре. Без свободного регистра в типе (compile-time строгость
   важнее терпимости к стилю), без сахар-методов, без связки `onAction`.
2. **Пять действий** — как в allowlist `assertReferentialAction`, включая
   `set default`; редкий случай описан в докстринге.
3. **`set null` + `notNull()` → throw** в `$build()`. Молча понижать nullability
   нельзя — это ослабляет инвариант модели без веома автора.
4. **`onUpdate` по умолчанию `NO ACTION`**, как сейчас. `CASCADE` по умолчанию
   был бы миграцией всех существующих баз и неявным изменением семантики.
5. **Действие только на ref-поле, владеющем FK-колонкой** (`!sourceModel`), не
   на обратной связи. Инверсия не транслируется.
6. **`alter-foreign-key` отдельной операцией**, а не `drop` + `add`, —
   из-за семантики `checkHealth`.

## Вне области

- Каскады в ORM (`orm.delete()` с автоматическим обходом графа) — это отдельная
  фича поверх DDL-каскадов, а не часть DSL. Cascade в БД уже выполняется
  сервером; ORM-level обход означал бы выдавать `DELETE FROM` по дереву в обход
  FK, что меняет семантику транзакций.
- `Deferrable` / `INITIALLY DEFERRED` — редкий случай, требует поддержки в
  `ReadonlySqb`; не тянем.
- Колоночные списки в `SET NULL (col)` / `SET DEFAULT (col)` (PG 18) — для
  составных FK, в kadmium всегда одна колонка.

## Проверка

```bash
npm run build
npm run check:type
npm run format:check
npm run lint
npm test --workspace packages/core      # ref.test.ts, compile.test.ts
npm test --workspace packages/sql-pg    # diff: types, compute, render, apply, health
cd test-project && npm run db:up && npm run test:project
```

`test-project` использует `dist`, поэтому `npm run build` перед интеграцией
обязателен. Модели `test-project` меняются — базу надо перемигрировать.

Обязательные регрессии: `set null` на nullable-колонке обнуляет значение при
удалении родителя; `cascade` удаляет детей; `no action` по-прежнему падает.