# Расширение DSL ссылочных данных — `onDelete` / `onUpdate` в `f.ref`

**Статус:** 📋 план готов, реализация не начата.

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
это заведомо падающая миграция: Postgres даст `ERROR: column "x" must be
nullable to use SET NULL` в момент `ALTER TABLE`, то есть ошибка всплывает
поздно и вне контекста.

### 3. `no action` и `restrict` для пользователя неразличимы

Оба запрещают удаление родителя при живых детях, различаясь лишь таймингом
проверки (end-of-statement vs немедленно). В DSL они сейчас не выразимы вовсе,
и когда появятся — надо понимать, что именно попадёт в `ON UPDATE`: смена
PK родителя по умолчанию ломает FK, но `onUpdate` тоже молчит.

---

## Решение

### DSL

```typescript
class Post extends Model {
  author = f.ref
    .target(User, 'posts')
    .manyToOne()
    .onDelete('cascade')       // NO ACTION | CASCADE | SET NULL | RESTRICT | SET DEFAULT
    .onUpdate('cascade');      // по умолчанию NO ACTION
}

class Comment extends Model {
  post = f.ref.target(Post, 'comments').manyToOne().onDelete('set null');
}
```

Методы принимают **строки в нижнем регистре** (`'cascade'`), потому что это
то, что читается в модели; в IR и SQL уходит канонический регистр
(`'CASCADE'`). Свободный регистр принимается и приводится к нижнему — иначе
пришлось бы писать `'cascade' | 'CASCADE' | 'Cascade'` в типе.

Дефолты: `onDelete` → `'no action'`, `onUpdate` → `'no action'`. Это сохраняет
поведение всех существующих моделей байт-в-байт: миграции не появятся там, где
`onDelete` не написан.

**Инверсия не транслируется.** `post.onDelete('cascade')` означает «при удалении
Post удалять Comment». На стороне `User.posts` (обратная связь, one-to-many)
действие не задаётся: FK живёт на стороне владельца. Если бы оно туда
прокидывалось, пришлось бы решить, что делать с двумя FK на одну пару таблиц —
вопрос, не относящийся к этой задаче.

### Валидация — на билдере, не на рендере

Несовместимые комбинации (`set null` + `notNull()`) отклоняются в
`$build()`, а не при миграции. Ошибка указывает строку модели, а не
`ALTER TABLE` в проде. `assertReferentialAction()` в sql-pg остаётся
defense-in-depth — он защищает ручной `applyDiff`, где валидации модели нет.

### Миграции — через diff, а не через отдельный путь

`expectedForeignKeys()` начинает читать `f.onDelete`/`f.onUpdate`. Действующая
логика `computeDiff` **не ловит изменение действия** — она сравнивает только
`fk.name` (`compute.ts:193`), поэтому смена `no action` → `cascade` на
существующей паре таблиц молча проигнорируется. Поэтому в этом же PR нужен
`AlterForeignKeyOp`: `DROP CONSTRAINT` + `ADD CONSTRAINT` одной операцией,
иначе фича работает только на свежих базах.

Порядок выбран сознательно: `DROP` идёт перед `ADD` в одном diff, обе операции
применяются транзакционно (`applyDiffTransactional`) — схема не остаётся без FK
между шагами.

---

## Разбивка на PR

Каждый PR — bisectable: собирается, проходит гейты и тесты сам по себе.

### PR1 — DSL: `onDelete`/`onUpdate` в `ReferenceFieldBuilder`

- `ReferenceFieldBuilder.onDelete(action)` / `.onUpdate(action)` +
  приватные поля в `model/fields/ref.ts`, проброс в `$build()`
- `ReferenceField.onDelete`/`onUpdate` в `model/types/ref.d.ts` — тип
  `ReferentialAction` в нижнем регистре
- Тесты: `packages/core/test/model/fields/ref.test.ts` — значения, дефолты,
  цепочка с `target`/`fk`/`inverse`, `set null` + `notNull()` бросает

**Не трогаем** IR, diff, DDL: билдер производит поле, которое пока никто не
читает. Это законченный вертикальный срез, который коммитится, даже если
следующие PR задержатся.

### PR2 — IR: проброс в `FieldIR`

- `ReferentialAction` в `ir/index.ts` (единственный источник истины для формы
  действия), `FieldIR.onDelete`/`onUpdate`
- `compile.ts`: копирование в `base.onDelete`/`base.onUpdate` — для прямых полей
  **и** для виртуальных inverse-ref'ов из `$refs()` и из прототипа родителя
  (три места: строки ~55, ~79, ~110)
- `ModelRelation` в `model/types/model.d.ts`: `onDelete`/`onUpdate` —
  `$refs()` теряет их, если не пробросить; без этого inverse-поля в IR будут
  без действия
- Тесты: `packages/core/test/model/compile.test.ts` — прямое поле, наследование
  от родителя, one-to-one vs one-to-many

### PR3 — diff: чтение действия + `AlterForeignKeyOp`

- `expectedForeignKeys()` читает `f.onDelete ?? 'NO ACTION'` (нормализация в
  верхний регистр — на границе IR, не в DDL)
- `AlterForeignKeyOp` в `sql-pg/src/diff/types.ts`: `{ type, fkName, tableName,
  oldFk, newFk }`
- `compute.ts`: сравнение по `name` **и** по `onDelete`/`onUpdate`/`refTable`/
  `columns` — расхождение даёт `alter-foreign-key` вместо `drop` + `add`
  (иначе на существующей паре таблиц смена действия не применится)
- `ddl-sql.ts`: `ALTER CONSTRAINT` не нужен — рендер через существующие
  `dropForeignKeySql` + `addForeignKeySql`
- `apply.ts`: case `alter-foreign-key` → два вызова ddl
- `ddl-validate.ts`: case `alter-foreign-key` → валидация обоих FK
- Тесты: `packages/sql-pg/test/diff/{types,compute,render}.test.ts` +
  фикстуры с непустым `onDelete` (сейчас все фикстуры — `NO ACTION`, смена
  действия не проверена нигде)

### PR4 — DDL: применение и интеграция

- `DbForeignKey` в `apply.ts`/`renderSql` уже принимает любой action —
  проверяем, что `addForeignKeySql` печатает `ON DELETE CASCADE`
- `test-project/test/db.test.ts` (или новый `test/ddl-fk.test.ts`):
  миграция на существующей базе меняет действие; `delete-api.test.ts` переводится
  с `clearDependents()` на каскад и теряет этот хелпер
- Модель `Comment.post` в `test-project/src/models/comment.ts` получает
  `onDelete('cascade')`, `Comment.user` — `set null` с nullable-колонкой

### PR5 — `SET NULL` требует nullable

Отдельный PR, потому что меняет **тип** полей, а не только DDL.

- Валидация уже в PR1; здесь — решение на уровне IR: `notNull()` +
  `onDelete('set null')` → либо авто-понижение `nullable`, либо sync-throw.
  Выбор: **sync-throw в `$build()`** — молча менять nullability нельзя, это
  ослабляет инвариант модели без ведома автора
- Кодоген: `codegen/generate-model.ts` — forward-ref уже печатается как
  `number | undefined` по `field.nullable`; проверяем, что `set null` не требует
  правок, иначе добавляем

### PR6 — `one-to-one` и `unique` (по необходимости)

`one-to-one` на стороне владельца требует `UNIQUE` на FK-колонке, иначе это
`many-to-one` в БД при заявленном `one-to-one` в DSL. Сейчас
`expectedIndexes()` создаёт индекс для любого ref, но `isUnique` берётся из
`f.unique`, а не из `relation === 'one-to-one'`. Расхождение уже есть, без
`onDelete`; здесь оно лишь становится заметнее. Оформить отдельно, если
тесты покажут реальные проблемы.

---

## Решения, требующие подтверждения

1. **Строки vs union-типы в DSL.** План берёт строки в нижнем регистре с
   нормализацией. Альтернатива — `onDelete(ReferentialAction)` с реэкспортом
   типа из DSL, что даёт compile-time ошибку вместо runtime. Ценой —
   необходимость импортировать тип в каждой модели. Нужно решение: ergonomics
   против строгости.

2. **`SET NULL` + `notNull()` — throw или авто-понижение.** План предлагает
   throw. Авто-понижение тише, но молча ослабляет модель.

3. **`onUpdate` по умолчанию.** План: `NO ACTION`, как сейчас. Альтернатива:
   `CASCADE` для `onUpdate` (смена PK обновляет ссылки) — чаще ожидаемое
   поведение, но это **миграция всех существующих баз** и неявное изменение
   семантики. Оставляем `NO ACTION` по умолчанию явно.

4. **Обратная связь.** План: `onDelete` задаётся только на стороне владельца
   FK, на `one-to-many` поле не действует. Альтернатива — разрешить и там,
   трактуя как «при удалении родителя этой связи», но тогда нужна явная
   семантика для случая, когда владелец объявлен с другой стороны.

---

## Проверка

```bash
npm run build
npm run check:type
npm run format:check
npm run lint
npm test --workspace packages/core      # ref.test.ts, compile.test.ts
npm test --workspace packages/sql-pg    # diff: types, compute, render, apply
cd test-project && npm run db:up && npm run test:project
```

Обязательные регрессии: `set null` на nullable-колонке обнуляет значение при
удалении родителя; `cascade` удаляет детей; `no action` по-прежнему падает;
`restrict` отличается от `no action` (на `ON UPDATE` — оба проверяются, так как
`ON DELETE` разница в PG не наблюдаема в одном запросе).

## Вне области

- Каскады в ORM (`orm.delete()` с автоматическим обходом графа) — это отдельная
  фича поверх DDL-каскадов, а не часть DSL. Cascade в БД уже выполняется
  сервером; ORM-level обход означал бы выдавать `DELETE FROM` по дереву в
  обход FK, что меняет семантику транзакций.
- `Deferrable`/`INITIALLY DEFERRED` — редкий случай, требует поддержки в
  `ReadonlySqb`; не тянем.