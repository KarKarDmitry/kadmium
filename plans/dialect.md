# План: диалектный слой и контракт миграций

**Статус:** 🚧 В работе (развязка core → sql-pg). Ниже — результат обсуждения
2026-10-02.

**Важность:** 🟡 Medium. Не ломает данные и не ломает пользователя, но
`AGENTS.md:40` сейчас описывает архитектуру, которой нет: core импортирует
`sql-pg` напрямую. Пока других диалектов нет, это безвредно. Как только
появится второй — правка станет дороже, потому что касается CLI.

**Нарушение, которое закрываем:**

```
AGENTS.md:40
No circular dependencies. Core never imports sql-pg directly.

packages/core/src/cli/db.ts:6-12
import {
  computeDiff, applyDiff, applyDiffTransactional,
  renderSql, checkHealth,
} from '@karkardmitry/kadmium-sql-pg';
```

Из-за этого `pgType`, `renderDefault`, `normalizePgType` пришлось выставить в
публичный экспорт пакета (`sql-pg/src/index.ts:368-378`): CLI должен их видеть,
хотя это внутренность адаптера.

---

## 1. Что уже сделано правильно

Проверено, чтобы не переделывать:

| Слой | Где | За контрактом? |
|---|---|---|
| AST построение | `core` | ✅ диалектно-нейтрально |
| SQL генерация, 1344 стр. | `sql-pg/src/sql-generator.ts` | ✅ `SqlAdapter.toSql(sbq)` |
| DDL выполнение | `sql-pg` | ✅ `DbDdlAdapter.inspect*/createTable/alterType` |
| Интроспекция | `sql-pg` | ✅ за `DbDdlAdapter` |
| **Diff-вычисление** | `sql-pg/src/diff/` | ❌ core импортирует напрямую |
| **Тип-маппинг** | `sql-pg/src/diff/types.ts` | ❌ core импортирует напрямую |

`SqlGenerator` объявлен `abstract` (`sql-generator.ts:235`), и
`PgAdapter extends SqlGenerator implements SqlAdapter` (`index.ts:193`).
Внутри он сплошь PG-специфичен — `ON CONFLICT` (`:126`), `RETURNING` (`:214`),
`LIMIT $N` (`:498`), кавычки `"` (`:214`), — и это правильно: SQLite-версия
пишется **внутри** `sql-pg`, core об этом не узнаёт.

SQL в core не течёт. Проверено грепом по `SELECT|INSERT INTO|UPDATE|DELETE FROM|
ORDER BY|CREATE TABLE` — все совпадения оказались строками ошибок, сборкой путей
и комментариями. Core импортирует только `sql-types`, в 23 местах.

**Вывод: архитектура в целом sound.** Нужен не новый слой, а один незакрытый
контракт.

---

## 2. Где именно утечка

Каталог `diff/` — 960 строк (`types` 366 + `compute` 284 + `apply` 146 +
`index` 100 + `render` 64).

Утечка локальная, потому что сами функции **уже принимают контракт**:

```ts
// diff/apply.ts:48-51
export async function applyDiff(diff: DiffResult, ddl: DbDdlAdapter): Promise<string[]>

// diff/compute.ts:19
export async function computeDiff(irs, ddl: DbDdlAdapter, ...)
```

Мешает единственное — жёсткий импорт из `./types`:

```ts
// diff/compute.ts:10-15
import { pgType, normalizePgType, isPrimaryField, irToColumns } from './types';
```

А `diff/types.ts` (366 строк) — свалка из трёх несвязанных вещей:

1. **маппинг типов** — `pgType`, `normalizePgType`, `renderDefault`
2. **контракт diff-а** — `DiffOp`, `DiffResult`, `HealthCheckResult`
3. **конвертация IR в форму БД** — `irToColumns`, `expectedIndexes`

Плюс `DiffOp`/`DiffResult` объявлены в пакете адаптера, поэтому core/cli тянет
**и типы, и функции** оттуда же.

---

## 3. Решение: контракт, не новый пакет

Физический `dialect-pkg` сегодня не окупается: у него один потребитель.
Окупается **интерфейс** — он же нужен для решений из `plans/data-types.md`
(см. §5).

### 3.1 `Dialect` в `sql-types`

```ts
export interface Dialect {
  /** Имя SQL-типа для поля. Бросает, если диалект не умеет этот тип. */
  typeName(field: IrField, irs: readonly IrModel[]): string;
  /** Нормализовать имя типа из интроспекции для сверки. */
  normalizeTypeName(name: string): string;
  /** Отрендерить DEFAULT как SQL-литерал. null — дефолта нет. */
  renderDefault(field: IrField): string | null;
  /** Значение параметра → форма, понятная БД. Вызывается ядром по tsType. */
  serializeValue(value: unknown, ctx: { tsType: string; field?: string }): unknown;
  /** Умеет ли диалект этот tsType. Даёт ошибку на DDL, а не в рантайме. */
  supports(tsType: string): boolean;
}
```

`sql-pg` реализует пять методов. Под `serializeValue` уже намечен `Duration` → PG-литерал (см. `plans/data-types.md` R7).

### 3.2 Переезд типов в контракт

`IrField` (`diff/types.ts:134-150`) — структурный тип, core не импортирует.
Переезжает в `sql-types` вместе с `DiffOp`, `DiffResult`, `HealthCheckResult`.

Совместимость с core проверена: `FieldIR` (`ir/index.ts:77-105`) структурно
удовлетворяет `IrField` — `type: FieldType`assignable в `type: string`,
`relation?: RelationType` совпадает по union'у
(`'one-to-many' | 'many-to-one' | 'one-to-one'`), `ReferentialAction` уже
приходит из `sql-types`. Правок в core не требуется.

### 3.3 Конфигурация

```ts
// packages/core/src/core/config.ts
export interface KadmiumModules {
  sql?: SqlAdapter;
  dialect?: Dialect;   // ← рядом с адаптером
}
```

`KadmiumModules` уже имеет единственный слот `sql?` (`config.ts:7-10`), так что
добавление рядом — естественно.

### 3.4 Развязка CLI

`core/cli/db.ts` начинает брать диалект из `config.modules.dialect` и работает
только с `sql-types`. Импорт `@karkardmitry/kadmium-sql-pg` из core
исчезает — и `AGENTS.md:40` снова правда.

---

## 4. Что НЕ переносим

### 4.1 `f` остаётся в core

Рассматривался вариант `import { f } from 'dialect-pg'`. Отклонён:

1. **DSL выражает намерение, а не возможность.** `f.interval` объявляет
   «календарный промежуток»; хранить его — задача диалекта. Ровно этот случай
   решает `supports()` + ошибка на DDL. SQLite-юзер получит внятное сообщение
   при миграции, и это правильное поведение, а не дефект.
2. **Композиция билдеров ломается.** `f.array(f.string.varchar(50))` — массив
   принимает билдер другого поля. Если `f` в диалекте, а `f.string` в core,
   билдеры одного поля склеиваются из двух пакетов, и составные типы (R9) будут
   склейкой на каждом шаге.
3. **Непропорционально.** PG-only билдеров ровно три: `interval`, `array`,
   `inet`. Ради них — пакет.

У drizzle колонки диалектные (`pgTable`/`sqliteTable`/`mysqlTable`), но он за
это **продублировал все query-билдеры**: `AnyPgSelectQueryBuilder`,
`MySqlSelectQueryBuilder`, отдельные под каждый диалект. У нас AST общий, и
дублировать нечего — но и выигрыш от выноса `f` не окупает цену.

### 4.2 `SqlGenerator` остаётся в адаптере

У каждого адаптера свой генератор целиком: `lateral` есть только у PG, у SQLite
`?` вместо `$N`, у MySQL `ON DUPLICATE KEY UPDATE` вместо `ON CONFLICT`.
Выносить нечего — это уже диалектный код по определению.

### 4.3 `escapeParam()` в интерфейс не закладываем

Соблазн добавить `escapeParam(): string` в `Dialect` отклонён: плейсхолдеры
живут внутри конкретного генератора (`sql-generator.ts:498` — `LIMIT $${...}`),
и выносить их в контракт незачем. Контракт уже абстрагирован на уровне
`SqlAdapter.toSql(sqb)` — вызывающему текст SQL не нужен.

---

## 5. Связь с `plans/data-types.md`

Два решения из плана типов требуют этот контракт:

- **R7** — сериализатор `Duration` живёт в `Dialect.serializeValue`, потому что
  `'3 days'` — литерал PostgreSQL, а не значение. Ядро решает **когда** (по
  `tsType`), диалект решает **как** (в формате PG).
- **Правило переносимости** — `Dialect.supports(tsType)` даёт адаптеру способ
  бросить ошибку на этапе DDL, а не подставить приблизительный аналог.

---

## 6. Порядок

| # | Пункт | Зачем в этом порядке |
|---|---|---|
| 1 | `IrField` + `DiffOp` + `DiffResult` + `HealthCheckResult` → `sql-types` | Чистое перемещение, поведения не меняет. `sql-types` начинает описывать миграции, а не только AST |
| 2 | `Dialect` в `sql-types` + реализация в `sql-pg` | Контракт появляется раньше первого использования |
| 3 | `KadmiumModules.dialect?` + прокидывание в `KadmiumApp` | Конфиг — точка подключения по умолчанию |
| 4 | `core/cli/db.ts` перестаёт импортировать `sql-pg` | Закрывает нарушение `AGENTS.md:40` |
| 5 | Убрать из экспортов `sql-pg` то, что стало `Dialect` | `pgType`/`normalizePgType`/`renderDefault` больше не публичный API |
| 6 | `supports()` на DDL | Дальше по `plans/data-types.md` |

Шаги 1-5 — одна тема, коммит резонно держать до ~300 строк. Шаг 6 зависит от
`plans/data-types.md` и идёт после.

---

## 7. Когда появится физический пакет

Когда появится диалект №2. Вынос `typeName`/`renderDefault`/`normalizeTypeName`/
`serializeValue`/`supports` из `sql-pg` в `dialect-pg` станет механическим
перемещением того, что уже за интерфейсом. Откладывая пакет, мы почти ничего
не теряем и не плодим четыре пакета ради одного диалекта.

Пять методов `Dialect` — это ровно то, что у drizzle лежит в `PgDialect`
(`escapeName`, `escapeParam`, `escapeString`, `buildQuery`, `migrate`), за
вычетом меток экранирования и `migrate` — они остаются в адаптере, потому что у
нас генерация уже за `SqlAdapter`.