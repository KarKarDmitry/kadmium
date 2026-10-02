# Типы данных: недостающие, сломанные, кастомные

**Статус:** 💤 Не начат. Ничего не реализовано. Ниже — результат обсуждения
2026-10-02: карта регистрации типа, найденные баги, итоговая матрица типов и
разбор кастомных типов.

**Важность:** 🔴 High. `date` вне UTC пишет неверную дату, `int8` портит любой
внешний идентификатор, `time` не создаёт колонку `time`, `numeric` приходит
строкой под обещанием `number`.

**Смежный план:** `plans/validation.md` — правила строятся поверх типов, поэтому
матрица `tsType` отсюда является для него входом. Порядок: типы → валидация.
Удаление `min`/`max` (раздел 5) строго после валидации.

**Новые зависимости:** ровно одна — `decimal.js` в `dependencies` ядра (нулевые
зависимости, свои типы, 136 KB). `f.interval` не добавляет ничего: парсер уже
есть в `pg-types`, а сериализатор пишется на месте.

---

## 1. Карта: сколько мест на самом деле

«Достаточно в 3-4 местах» — на самом деле ~10, и **пять из них молчаливые**.

| Место | Файл | При неизвестном типе |
|---|---|---|
| `FieldType` | `core/src/ir/index.ts:13` | — union |
| **`normalizeType()`** | `core/src/model/compile.ts:147` | **→ `'string'`** (`compile.ts:164`) |
| билдер + `.d.ts` | `core/src/model/fields/*`, `model/types/*` | — |
| **`pgType()`** | `sql-pg/src/diff/types.ts:152` | **→ `'text'`** (`types.ts:189`) |
| **`renderDefault()`** | `sql-pg/src/diff/types.ts:213` | **→ цитата в `'...'`** |
| **`createBaseFilter()`** | `core/src/orm/field-builders/factory.ts:51` | **→ голый `BaseFilter`** (`factory.ts:71`) |
| `normalizePgType()` | `sql-pg/src/diff/types.ts:193` | входит в сверку для `alter-type` |
| value parser | `sql-pg/src/index.ts:39` | переопределён только oid 20 |
| tsType в кодогене | `core/src/codegen/generate-model.ts:85` | ref жёстко `'number'` |
| маппинг строки результата | `core/src/orm/builders/utils.ts:15` | сейчас только alias, без coercion |

Для нативного типа молчаливые fallback'и безобидны. Для кастомного — генератор
тихих поломок: опечатка в имени типа даёт валидный неверный DDL вместо ошибки.

---

## 2. Принятые решения

### R1. `f.pk.bigint` и дефолтный `f.pk` остаются `number`

Без изменений. `f.pk` без аргументов — это и есть bigint
(`primary.ts:86` → `BigIntPrimaryFieldBuilder`, `tsType: 'number'`), поэтому
переход на `bigint` в TS ударил бы по **каждой** модели: `~shape` меняется,
`JSON.stringify` кидает `TypeError: Do not know how to serialize a BigInt`,
`id + 1` перестаёт компилироваться, фильтры требуют нового класса.

### R2. `bigintString` — точный целочисленный, плюс сторож

- `f.pk.bigintString` и `f.number.bigintString` → `type: 'bigint'`,
  `tsType: 'string'`. Точное значение, колонка остаётся `bigint` — **миграция не
  нужна**, меняется только TS-объявление, потому что `pgType()` у обоих
  вариантов один.
- **Сторож при чтении:** если `Number(str)` теряет точность
  (`!Number.isSafeInteger`) — бросать, а не отдавать мусор.
- Свой фильтр обязателен: `StringFilter` не подходит, у него есть
  `like`/`ilike`, а `id ILIKE '5'` — это PG `42883 operator does not exist`.
  Нужен класс с `eq/neq/gt/gte/lt/lte/between/in` и строковыми операндами.
- Следствие: `createBaseFilter()` обязан переключаться на **`ir.tsType`**, а не на
  `ir.type` — `bigint` встречается с двумя разными `tsType`. Это попутно сносит
  параллельный enum в `factory.ts` (`uuid`/`int`/`decimal`/`float`/`numeric`
  перечислены руками, а реальных классов всего четыре).

#### Почему `Decimal` не заменяет `bigintString`

Отклонённая альтернатива: сделать `f.pk.bigint` → `Decimal` и обойтись одним
типом точности. Отклонено по четырём причинам:

1. **`Decimal` — дробный тип.** На идентификаторе появятся `.div()`, `.round()`,
   `.toFixed()`, `.dp()` — там, где считать нечего.
2. **`numeric` вдвое тяжелее `bigint`**: 16 против 8 байт на том же значении
   (B12). PK индексируется на каждой вставке.
3. **Глобальный изменяемый конфиг.** `Decimal.set({precision})` —
   process-wide. Чужой вызов в приложении изменит арифметику всех моделей
   kadmium в процессе. ORM не должен наследовать такой источник.
4. **Мотивация не совпадает.** Снежинка 2.1e18 не влезает в 2^53, но сильно
   меньше max int8 — ей нужен `string`, а не `numeric`. `numeric` для целых не
   нужен ни одному реальному случаю.

Побочно: фильтры `Decimal` и `bigintString` — одна форма (сравнения с операндом
**не** типа `number`), поэтому это общий базовый класс + два тонких наследника,
а не две реализации.

Текст ошибки сторожа:

```ts
bigint value 1790931439150012345 in column "User"."id" cannot be represented
as a JS number without precision loss (Number.MAX_SAFE_INTEGER is 9007199254740991).

Use a string-backed bigint instead — the column stays `bigint`, no ALTER required:

    id = f.pk.bigintString          // primary key
    amount = f.number.bigintString  // regular column

Do not switch to f.number.decimal — that changes the column type to `numeric`.
```

Бросается в coercion-слое, поэтому модель и колонка известны. Последняя строка
необходима: без неё первым рефлексом будет `.decimal()`, а это реально меняет
тип колонки.

**Приоритет.** B4 показал, что снежинка портится у каждого, кто хранит внешний
ID. Значит сторож выстрелит заметно чаще, чем ожидалось для «крайнего случая» —
это не точечное изменение, а ломающее по поведению, и его надо вынести в
changelog отдельной строкой.

### R3. Coercion переезжает из адаптера в core

**Адаптер не может решить R2 в одиночку:** `getTypeParser(oid)` не знает ни
колонки, ни таблицы, значит в одном процессе нельзя иметь `f.pk → number` и
`f.bigintString → string`.

Хорошая новость: `pg-types` **сам отдаёт int8 строкой** — `parseBigInteger`
возвращает `valStr` намеренно, ради точности (`textParsers.js:113-117`).
Переопределение `Number(val)` в `sql-pg/index.ts:40` и есть источник потери.

Готовое место: **`mapRow(ir, row)` в `core/src/orm/builders/utils.ts:15`** — уже
принимает `ModelIR` и обходит поля.

Разрыв: `mapRow` зовут `insert`/`update`/`delete`/`upsert`, а
**`select.ts:476` возвращает `adapter.execute()` как есть** — ни `mapRow`, ни
coercion. SELECT надо подключать отдельно.

План: убрать override oid 20 в sql-pg, добавить per-column coercion в core по
`tsType`: `number` ← строка (bigint/numeric/int), `string` ← оставить, с
сторожем на `Number.isSafeInteger`.

### R4. `date` и `time` → `string`. `datetime` → `Date`

Матрица:

| DSL | PG сейчас | PG нужно | TS сейчас | TS будет |
|---|---|---|---|---|
| `f.datetime` | `timestamp` | `timestamp` | `Date` | **`Date`** — оставить |
| `f.datetime.date()` | `date` | `date` | `Date` | **`string`** |
| `f.datetime.time()` | **`timestamp`** | `time` | `Date` | **`string`** |

Обоснование — не «удобнее», а `Date` **не умеет** сказать «второе октября, время
не важно», не опираясь на TZ (см. баг B2). Побочно чинится `JSON.stringify` и
`toISOString()`.

`datetime` — единственный здоровый: и запись (локальные компоненты), и чтение
(`postgres-date` → локальное время) используют одну зону, поэтому round-trip
сходится. Ломается только если TZ процесса поменяется между записью и чтением.

Следствие: `_validate` у обоих становится осмысленным для строк
(`/^\d{4}-\d{2}-\d{2}$/` и `/^\d{2}:\d{2}(:\d{2})?$/`) вместо требования
магической полуночи UTC / даты `1970-01-01`.

### R5. Добавить `f.datetime.withTimeZone()` — да

**Единственный из четырёх, где момент времени осмыслен.** Остальные хранят
местную строку, `timestamptz` хранит инстант: сдвиг зоны его не ломает, потому
что PG нормализует в UTC и offset при записи, и при чтении.

Проверено на живой базе:
- `format_type('timestamptz')` → `timestamp with time zone` — ровно то, что
  вернёт `information_schema.columns.data_type`
- `'2026-10-02T00:00:00.000Z'::timestamptz` → `2026-10-02 00:00:00+00` (offset
  уважается, в отличие от B5)
- парсер oid 1184 в `pg-types` зарегистрирован

Что нужно тронуть:
- **флаг в `spec`**, по образцу `db_type`: `withTimeZone()` кладёт
  `db: { ...base.db, tz: true }` (`fields/datetime.ts`), `compile.ts:33` копирует
  его в `spec` (одна строка рядом с `if (dbType) spec.db_type = dbType`)
- **обработка в DDL**: `pgType()` (`diff/types.ts:186`) — одна строка
  `if (f.spec?.tz) return 'timestamp with time zone'`
- `tsType` не меняется — остаётся `Date`, поэтому `renderDefault`
  (`case 'datetime'`) и фильтр (`DateFilter`) покрывают оба случая без правок

**Почему флаг, а не новый IR-тип `timestamptz`.** Новый тип обязан получить
явный `case` в `renderDefault`, иначе провалится в `default:`, где
`String(new Date())` даёт `"Fri Oct 02 2026 00:00:00 GMT+0300"` → в
`DEFAULT '...'` → битый DDL. С флагом `case 'datetime'` покрывает оба случая, и
для `timestamptz` он даже правильнее: `toISOString()` даёт `Z`, а `timestamptz`
offset уважает — в отличие от B5.

**Почему не расширять `db_type` на не-primary (дизайн A-lite).** `db_type` —
это escape hatch для raw-типа на уровне адаптера, и его allowlist
(`types.ts:161-165`) намеренно живёт внутри `if (f.type === 'primary')`.
Смысл `timestamptz` задаёт core, а PG-имя типа — адаптер; протекание этого
знания в общий allowlist смешало бы два слоя. Флаг идёт в `spec` и читается
только в DDL. **R5 при этом не ждёт дизайн A** — тот нужен для кастомных
типов (раздел 6) и ничего общего с флагом не имеет.

**Почему возвращать длинную форму, а не `timestamptz`.** Обе стороны diff
нормализуются (`diff/compute.ts:120-121`), и у `normalizePgType` есть ветка
`timestamp without time zone → timestamp`, но **нет** ветки для `with`.
Значит `pgType → 'timestamptz'` не совпадёт с интроспекцией, которая вернёт
`timestamp with time zone` → тихий бесконечный `alter-type`.

Общее правило, всплывшее отсюда: **везде, где у `normalizePgType` нет ветки-коллапсера, `pgType` обязан отдавать ровно то, что вернёт интроспекция.** Проверено:
`format_type` даёт `timestamp with time zone`, `timestamp without time zone`,
`date`, `time without time zone`, `numeric(5,2)`, `character varying(50)`,
`bigint[]` — то есть ни сюрпризов, ни `timestamp(3) with time zone`.

**Подводный камень на будущее:** естественный дефолт для `timestamptz` —
`now()`. `renderDefault()` всё цитирует в строки, поэтому `DEFAULT 'now()'`
будет поломан. Сейчас `now()` kadmium не пишет вовсе (только `spec.default`
как JS `Date`), но это надо помнить при расширении.

### R6. `f.number.decimal` → `Decimal` из `decimal.js`

В TS нет примитива `decimal` (примитивы: `string`, `number`, `bigint`,
`boolean`, `symbol`, `undefined`, `null`, `object`), а core держит
zero-dependency. Ограничение снято осознанно, проверено на пакете:

| Проверено | Результат |
|---|---|
| Зависимости | **ноль** (поле `dependencies` отсутствует) |
| Файлов | 6, код — один |
| Размер | 136 KB unminified / 127 KB ESM |
| Типы | свои, `decimal.d.ts` 9 KB — `@types/*` не нужен |

Ключевое из `.d.ts`: `toJSON(): string` (в JSON уходит строкой — не бросает и не
теряет точность), `constructor(n: string | number | bigint | Decimal)`
(`new Decimal(pgString)` без потерь прямо из провода), `valueOf(): string`,
`dp()` / `toFixed(dp)` для `decimal(n, m)`, `static isDecimal()` для
runtime-разбора.

**Своя реализация отклонена:** корректное десятичное деление требует политики
точности и режима округления — это ровно то, что рукописный код делает тихо
неправильно, и заодно делает владельцем багов в денежной арифметике. Ради
одного файла в 136 KB без зависимостей цена не окупается.

Размещение — `dependencies`, не `peerDependencies`. С `peer` у приложения будет
своя копия, и `Decimal.isDecimal` упадёт на экземпляре из чужого
`node_modules`. Транзитивный пакет в 136 KB — приемлемая цена.

- `f.number.decimal()` → `numeric`, `tsType: 'Decimal'`
- `f.number.decimal(n, m)` → `numeric(n, m)`, `tsType: 'Decimal'`
- **`m` по умолчанию 0.** В PG `numeric(5)` — это scale 0, то есть ловушка:
  `f.number.decimal(5)` молча запретит дробную часть. Об этом должен подумать
  разработчик, а не библиотека.
- Обязательно B11: нормализация `Decimal` → строка на границе параметров
- `DecimalFilter` рядом с `NumberFilter`, общий с фильтром `bigintString` (R2)
- `plans/validation.md` должен выдавать `Decimal.Value` для decimal-полей,
  чтобы правила принимали и строку, и `Decimal`

### R7. `f.interval` → `Duration`, плоский объект

Третий случай, где «просто `Date`» не работает (первые два — `date` и `time`).
`interval` — не длительность, а календарно-зависимый промежуток, поэтому нужен
свой тип.

**Форма — плоский разреженный объект, не `Record` и не экземпляр
`postgres-interval`:**

```ts
interface Duration {
  years?: number
  months?: number
  days?: number
  hours?: number
  minutes?: number
  seconds?: number
  milliseconds?: number
}
```

Семь известных ключей, все опциональны. `Record<string, number>` не подходит:
он открытый, `{foo: 1}` и опечатка `d.day` скомпилируются. Замеры
`postgres-interval` показывают именно эту форму:

```
"3 days"           →  {"days":3}
"1 year 2 months"  →  {"years":1,"months":2}
"-00:30:00"        →  {"minutes":-30}
```

Три свойства, которые запрещают свести `interval` к числу:
- **разреженность** — `{"days":3}`, а не семь нулей;
- **знак в каждой компоненте** — `-00:30:00` даёт `{minutes: -30}`, а **не**
  `{seconds: -1800}`, так что знак суммы не выводится;
- **календарность** — у `1 month` нет фиксированной длины в секундах, и сам PG
  требует опорную дату: `'2026-01-31' + '1 month'` = `2026-02-28`.

Отсюда: никакой арифметики в типе. Арифметика требует опорной даты, которой у
значения нет.

**Чтение бесплатно.** `pg-types` уже парсит interval сам:

```
node_modules/pg-types/lib/textParsers.js:4
var parseInterval = require('postgres-interval');
node_modules/pg-types/lib/textParsers.js:199
register(1186, parseInterval);
```

Парсер писать не нужно — достаточно объявить `tsType: 'Duration'`.

**Запись требует своего сериализатора.** Замерено:

```
плоский объект {days: 3}  →  "{\"days\":3}"     ← JSON, в БД улетит мусор
экземпляр PostgresInterval →  "3 days"          ← корректный литерал
```

`pg` зовёт `toPostgres()` только когда метод реально есть, поэтому экземпляр
проходит, а объектный литерал падает в `JSON.stringify` (тот же механизм, что
B11). Свой сериализатор нужен ровно затем, чтобы пользователю не пришлось
конструировать `new PostgresInterval(...)` — это зависимость адаптера, и тащить
её в публичный API ядра нельзя.

- сериализатор живёт в core рядом с прочими `tsType`-coercion, отдаёт строку
  литерала, PG выводит тип из контекста — как в B11
- на вход принимается и строка (`'3 days'`), и объект
- ни `postgres-interval`, ни что-либо ещё в `dependencies` ядра не добавляется

### R8. `f.string` → `text`, `.varchar(n)`, `f.text` → `text`

| DSL | PG | Смысл |
|---|---|---|
| `f.string` | `text` | однострочный, без ограничения длины |
| `f.string.varchar(n)` | `character varying(n)` | однострочный, длина ограничена |
| `f.text` | `text` | многострочный |

**Важно: PG не различает однострочное и многострочное.** И `varchar`, и `text`
принимают перевод строки одинаково; разница только в длине. Значит
`f.string` и `f.text` дают **один и тот же** PG-тип и различаются только
семантикой в TS и правилом в `$validation` («в `f.string` нет `\n`» → `CHECK`).
Это нормальная конструкция, но колонка сама перевод строки не запретит.

Следствие: `f.pk.string` тоже уезжает в `text`, а не `character varying`.

Требует B10, иначе `(n)` не попадёт в сверку и длина станет невидимой.

### R9. `f.array(<поле>)`

Форма с билдером удачная: элемент уже несёт свой `tsType`, поэтому
`f.array(f.string.varchar(50))` выражается сам собой.

- `pgType()` → `<элемент>[]`
- запись бесплатна: `prepareValue` на массиве даёт `{1,2,3}` сам, каст не нужен
- чтение бесплатно: `_text`/`_int4`/`_int8` зарегистрированы в `pg-types`
- **coercion обязан быть элементно-типизированным.** `parseBigIntegerArray`
  отдаёт **строки**, поэтому `f.array(f.number.bigint)` при объявленном `number`
  приезжает `string[]`. Значит объявленный `tsType` элемента решает:
  `number` → конвертировать и пропустить через сторож; `string` → не трогать
- `f.array(f.number.bigintString)` → `string[]` без потерь
- составные элементы работают: `f.array(f.number.decimal(12,2))` → `Decimal[]`,
  `f.array(f.datetime.date())` → `string[]`
- свой `ArrayFilter`: `= ANY($1)`, `@>`, `<@`, `&&`
- требует B10 — без `format_type` массив неразличим (см. B10)

Связь с `plans/validation.md`: правило «каждый элемент» требует понятия
per-element правила, которого в валидации пока нет.

---

## 3. Найденные баги

### B1. `f.datetime.time()` не создаёт колонку `time` 🔴

`sql-pg/src/diff/types.ts:186`:

```ts
if (f.type === 'datetime' || f.type === 'time')
  return 'timestamp without time zone';
```

Колонка `time` в БД не появляется — получается `timestamp` с запечённой датой
`1970-01-01`. Проверка «не содержит компонентов даты»
(`datetime.ts:73-80`) валидирует то, чего в схеме нет.

Побочно: `normalizePgType` (`types.ts:197`) обрабатывает
`'time without time zone' → 'time'`, но `pgType()` такое никогда не отдаёт —
мёртвый код. А если `time`-колонка создана руками, diff вечно предложит
`alter-type` в `timestamp`.

### B2. `f.datetime.date()` портит дату вне UTC 🔴

`_validate` требует **UTC** полуночи (`datetime.ts:47-53`), а `pg` пишет
**локальные** компоненты (`pg/lib/utils.js:87-100`; `parseInputDatesAsUTC: false`
в `defaults.js:61`, kadmium его не меняет). В UTC совпадает, дальше нет.

Проверено, полный путь `dateToString` → `date` → `postgres-date`:

| TZ | вход проходит `_validate` | записали | прочитали | `_validate` |
|---|---|---|---|---|
| UTC | ✅ | 2026-10-02 | `2026-10-02T00:00:00Z` | ✅ |
| Asia/Tokyo | ✅ | 2026-10-02 | `2026-10-01T15:00:00Z` | ❌ |
| America/New_York | ✅ | **2026-10-01** | `2026-10-01T04:00:00Z` | ❌ |

Два симптома:
1. В Нью-Йорке **в базу пишется не та дата** — просили 2-е, записалось 1-е
2. Вне UTC результат чтения **не проходит собственную проверку поля** —
   round-trip ломает инвариант билдера

`postgres-date` насильно ставит локтную полночь, поэтому одна строка из БД даёт
три разных `Date` в зависимости от TZ процесса.

### B3. `numeric` приходит строкой 🟡

Для oid 1700 в `pg-types` нет парсера → `noParse` (`pg-types/index.js:17,30`)
→ сырая строка, а `~shape` обещает `number`.

С B11 это перестаёт быть багом: `numeric` приезжает строкой и превращается в
`Decimal` — точно и без потерь. Тип, который в PG не парсится, оказывается
единственным, кто отдаёт точное значение без участия `Number()`.

### B4. `int8` теряет точность 🔴 (не крайний случай)

`sql-pg/index.ts:40` насильно `Number(val)`. `MAX_SAFE_INTEGER` = 9.007e15.
Проверено на текущий момент:

| | Значение | В `bigint` | В 2^53 |
|---|---|---|---|
| Twitter snowflake | 2 105 978 510 026 735 616 | ✅ запас 7.12e18 | ❌ портится |
| Discord snowflake | 1 555 537 240 568 889 344 | ✅ | ❌ портится |

То есть **любой** снежинок сегодня читается как мусор. `bigint` для этой схемы
кончится примерно в 2080 году. Значит проблема касается не «редкого случая»,
а каждого, кто хранит внешний идентификатор — а это обычная практика.

Починится вместе с B3 переездом coercion в core (R3) + `bigintString` (R2).

### B5. `default` и переданное значение — разные на одном Date 🟡

`renderDefault()` (`types.ts:228-232`) пишет `value.toISOString()`, то есть
**UTC** wall-clock. Параметры идут через `dateToString`, то есть **локальный**
wall-clock. PG offset для `timestamp without time zone` **игнорирует** —
проверено: `'2026-10-02T00:00:00.000Z'::timestamp` = `2026-10-02 00:00:00`.

Итог под `Asia/Tokyo`: `default: new Date('2026-10-02T00:00:00Z')` → в БД
`00:00`, а `.go({ when: new Date('2026-10-02T00:00:00Z') })` → `09:00`. Один
Date, девять часов разницы, в зависимости от пути записи.

### B6. `varchar(n)` объявить нельзя 🟡

`character_maximum_length` читается (`sql-pg/src/ddl-adapter.ts:78`) и
**выбрасывается** — в `DbColumn` поля длины нет (маппинг `ddl-adapter.ts:99-110`).
`pgType()` отдаёт `character varying` без длины, поэтому diff не зацикливается,
но длина просто не моделируется. Лечится R8 (`.varchar(n)`), но работать
будет только после B10 — иначе `(n)` не попадёт в сверку.

### B7. Четыре молчаливых fallback'а 🟡

`normalizeType()` → `'string'` (`compile.ts:164`), `pgType()` → `'text'`
(`types.ts:189`), `renderDefault()` → цитата (`types.ts:233`), `createBaseFilter()`
→ голый `BaseFilter` (`factory.ts:71`). Сводятся к громким ошибкам в одном месте.

### B8. Кодоген врёт про ref'ы 🟢

`generate-model.ts:85`: `const tsType = field.ref ? 'number' : field.tsType`.
Ref на `bigintString`-PK будет типизирован `number`. Строка 16 там же отдельно
вылезает из `db_type !== 'uuid'` — хрупкая связка.

### B9. `date`/`time` не покрыты тестами 🟡

`DateFieldBuilder` и `TimeFieldBuilder` — **ноль тестов**, ни unit, ни интеграционных.
`datetime.test.ts` покрывает только `DateTimeFieldBuilder`. В живой базе ни одной
`date`/`time` колонки. Это и объясняет, почему B1 и B2 дожили.

### B10. `information_schema` не годится ни для чего нового 🔴 (блокер)

Из исходника view:

```
WHEN t.typelem <> 0 AND t.typlen = -1 THEN 'ARRAY'
ELSE 'USER-DEFINED'
```

- массив **любого** состава → `data_type = 'ARRAY'`, имя живёт в `udt_name` (`_text`)
- enum и любая extension-типа → `'USER-DEFINED'`, имя в `udt_name`
- **domain поверх встроенного → базовый тип**

`normalizePgType()` для этого не спасает — он не видит типа вообще. Пока
интроспекция читает `data_type`, любой такой тип даст бесконечный цикл
`alter-type`.

**`format_type(a.atttypid, a.atttypmod)` закрывает всё разом.** Проверено:

```
numeric(5,2)   -> numeric(5,2)
varchar(50)    -> character varying(50)
bigint[]       -> bigint[]
numeric        -> numeric
```

Сейчас `data_type` отдаёт `numeric` без `(5,2)` и `character varying` без
`(50)` — точность, масштаб, длина и тип элемента массива **невидимы** для сверки.
Поэтому B10 — не «нужен только для кастомных типов», а блокер сразу для
`varchar(n)` (R8), `decimal(n, m)` (R6) и `f.array` (R9). Отсюда его подъём на
третье место в очереди.

Сопутствующий баг в `normalizePgType` (`types.ts:200`):
`if (t.startsWith('varchar')) return 'varchar'` — **отбрасывает длину**. Значит
`varchar(50)` и `varchar(200)` неразличимы и смена длины не даст `alter-type`.
Рядом стоит точное `t === 'character varying'` (`types.ts:195`). Две ветки, одна
ломает. При переходе на `format_type` это убрать.

### B11. `Decimal` уедет в параметр в кавычках 🔴

`pg` сериализует параметры в `prepareValue` → `prepareObject`
(`pg/lib/utils.js:44-83`). `Decimal` — объект, не `Date`/`Array`/`Buffer`,
поэтому уходит в `prepareObject`, а тот при отсутствии `toPostgres` делает
**`JSON.stringify(val)`**. У `Decimal` есть `toJSON(): string`, поэтому

```
JSON.stringify(new Decimal('1.5')) === '"1.5"'
```

— **с кавычками**. Такое значение уедет в `$1` и упадёт на `numeric`.

Симметрия полезна для диагностики: `renderDefault()` делает `String(value)` →
`valueOf()` → `'1.5'` ✅, а путь параметров → `JSON.stringify` → `"1.5"` ❌.
Одна строка разницы, и оба пути ведут себя по-разному.

Обязательна нормализация на границе параметров:
`if (Decimal.isDecimal(v)) v = v.toString()`. Без неё первое же
`WHERE amount = $1` падает.

### B12. `numeric` вдвое тяжелее `bigint` для целых 🟢 (мотивация, не баг)

Проверено `pg_column_size` для одного и того же значения 1790931439150012345:

```
bigint   = 8 байт
numeric  = 16 байт
```

PK лежит и в индексе, и в heap. Это довод **против** замены `bigintString` на
`Decimal` (см. R2), а не отдельная задача.

---

## 4. Про `$1::bigint`: не нужен

`node-postgres` пишет **любой** не-Buffer параметр как **type OID 0**
(unspecified) в текстовом формате (`pg-protocol/src/serializer.ts:116-117,136-137`),
поэтому тип выводит сервер из контекста. Проверено на `kadmium-test-pg`:

| Конструкция | Параметр | Результат |
|---|---|---|
| `SELECT pg_typeof($1)` | `'1'` | `could not determine data type of parameter $1` |
| `WHERE id > $1` | `'0'` | ✅ 1 строка |
| `WHERE id BETWEEN $1 AND $2` | `'1'`, `'3'` | ✅ 3 строки |
| `WHERE id IN ($1,$2)` | `'1'`, `'2'` | ✅ 2 строки |
| `LIMIT $1` | `'1'` | ✅ 1 строка |
| `UPDATE t SET id=$1 WHERE id=$2` | — | ✅ подготовилось |

Первая строка и доказывает, что типизации на клиенте нет. Каст упал бы только на
параметре без привязки к колонке — kadmium такие не генерирует.

**Запись не требует ничего; работа адаптера — только чтение.**

---

## 5. Итоговая матрица

`Статус` — ✅ есть · 🆕 добавить · 🔁 меняется.

| DSL | PG | TS | Статус |
|---|---|---|---|
| `f.string` | `text` | `string` | 🔁 было `character varying` |
| `f.string.varchar(n)` | `character varying(n)` | `string` | 🆕 R8 |
| `f.text` | `text` | `string` | 🆕 R8 |
| `f.bool` | `boolean` | `boolean` | ✅ |
| `f.number` | `integer` | `number` | ✅ |
| `f.number.decimal()` | `numeric` | **`Decimal`** | 🔁 было `number`, R6 |
| `f.number.decimal(n, m=0)` | `numeric(n, m)` | `Decimal` | 🆕 R6 |
| `f.number.bigint` | `bigint` | `number` | 🆕 новое |
| `f.number.bigintString` | `bigint` | `string` | 🆕 R2 |
| `f.number.float` | `double precision` | `number` | 🆕 новое |
| `f.datetime` | `timestamp` | `Date` | ✅ единственный здоровый |
| `f.datetime.date()` | `date` | **`string`** | 🔁 было `Date`, R4 |
| `f.datetime.time()` | `time` | **`string`** | 🔁 было `Date`, R4+B1 |
| `f.datetime.withTimeZone()` | `timestamptz` | `Date` | 🆕 R5 |
| `f.interval` | `interval` | `Duration` | 🆕 R7 |
| `f.uuid` | `uuid` | `string` | 🆕 новое |
| `f.binary` | `bytea` | `Buffer` | 🆕 |
| `f.inet` | `inet` | `string` | 🆕 |
| `f.array(<поле>)` | `<элемент>[]` | по `tsType` элемента | 🆕 R9 |
| `f.pk` / `f.pk.bigint` | `bigint` | `number` | ✅ R1, без изменений |
| `f.pk.bigintString` | `bigint` | `string` | 🆕 R2 |
| `f.pk.string` | `text` | `string` | 🔁 было `character varying`, R8 |
| `f.pk.uuid` | `uuid` | `string` | ✅ работает |
| `f.ref` | = PK цели | = `tsType` цели | ✅ наследует (`types.ts:167-176`) |
| `f.ref.oneToOne` / `.manyToOne` | то же | то же | ✅ 1:1 добавляет `UNIQUE` (`4ea10ce`) |

Три наблюдения по матрице:

- **`f.ref` наследует `tsType` цели** — значит `f.ref` на `bigintString`-PK сам
  даст строковые ref'ы, руками править ничего не надо.
- **`f.number.decimalString` отпадает как отдельный тип** — `Decimal` его
  покрывает.
- **`f.string` и `f.text` дают одинаковый `text`** и различаются только
  валидацией (R8).

### Мёртвая поверхность

| Что | Где | Состояние |
|---|---|---|
| `f.string.min/max` | `string.ts:12,17` | 6 записей, **0 чтений** |
| `f.number.min/max` | `number.ts:17,22` | то же |
| `f.datetime.min/max` | `datetime.ts:19,25` | то же, и бессмысленно для `date` |
| `StringPrimaryField_Spec` | `primary.d.ts:16` | `'auto' \| 'input'`; `'input'` нечем произвести, `'auto'` не читает никто |

**Удаление `min`/`max` — строго после `plans/validation.md`.** Замена им — это
`$validation`, а он не реализован. Убрать раньше = оставить пользователя без
ограничений и без правил.

| Было | Стало |
|---|---|
| `f.number.min/max` | `r.gte` / `r.lte` в `$validation` |
| `f.datetime.min/max` | то же |
| `f.string.min/max` | `.varchar(n)` на типе, либо правило длины |

---

## 6. Кастомные типы

**Готовый escape hatch на 80% собран.** `db_type?: string` объявлен свободной
строкой (`model/types/_base.d.ts:10`), тащится в `spec.db_type`
(`compile.ts:29,33`) и читается в `pgType()` (`types.ts:160`) — но **только**
внутри `if (f.type === 'primary')`. Для обычного поля игнорируется полностью.

- **Дизайн A — дописать `db_type` для не-primary.** Снять гейт
  `if (f.type === 'primary')`, прокинуть в `renderDefault`/`normalizePgType`,
  выбрать filter-класс. Дёшево, но не даёт ничего сверх «написать SQL-тип руками».
- **Дизайн B — registry** `f.customType('inet', { tsType, filter, parse })`.
  `normalizeType`, `pgType`, `renderDefault`, `createBaseFilter` начинают смотреть
  в реестр. Тот же объём правок плюс реестр на сопровождении.

**Рекомендация: A сейчас, B потом.** A превращает два молчаливых fallback'а в
громкие ошибки, а это нужно независимо от того, будет ли кастомный тип. B имеет
смысл, только если пользователям нужно что-то кроме имени типа.

Предпосылка для обоих — B10 (`format_type` в интроспекции).

---

## 7. Очередность

| # | Пункт | Почему в этом порядке |
|---|---|---|
| 1 | **B3+B4**: убрать override oid 20, coercion в core по `tsType` + сторож | Чистые баги, рефакторинга интроспекции не требует. Ломает поведение (B4 — не крайний случай), нужна строка в changelog |
| 2 | **B5**: `renderDefault` в локальную зону, как `dateToString` | Тот же слой, что (1). Чинит 9-часовой разрыв |
| 3 | **B10**: `format_type` + убрать `startsWith('varchar')` | **Поднят на 3** — блокер сразу для `varchar(n)`, `decimal(n,m)` и массивов |
| 4 | **B9+B1+B2**: тесты на date/time, `pgType` для `time`, `date`/`time` → `string` | Ломающее изменение `~shape`, но альтернатива пишет неверные данные |
| 5 | **B7**: молчаливые fallback'и → громкие ошибки | Мелочь, но открывает (10) |
| 6 | **R5** `withTimeZone()` — флаг `tz` в `spec` + ветка в `pgType` | ~3 строки. Самостоятелен, ни на что не завязан |
| 7 | **R8** `varchar(n)` / `f.text` + **R6** `decimal(n,m)` | После (3), иначе длина и масштаб невидимы |
| 8 | **B11**: `Decimal` → строка на границе параметров | Обязательно вместе с (7), иначе `WHERE amount = $1` падает |
| 9 | Недостающие билдеры под уже готовый адаптер: `f.uuid`, `f.number.bigint`, `f.number.float` | `pgType()` и `createBaseFilter()` их оба обрабатывают, ~60 строк, ноль правок в sql-pg |
| 10 | **B8**: кодоген и ref на реальный `tsType` | Ожидает дизайн A |
| 11 | Дизайн A: `db_type` для не-primary | После (3) |
| 12 | **R2** `bigintString` + общий фильтр с `Decimal` | Вместе с (1), фильтр отдельно |
| 13 | **R9** `f.array` + `ArrayFilter` + элементный coercion | После сходимости (3) |
| 14 | **R7** `f.interval` + сериализатор `Duration` | Чтение бесплатно (`pg-types` уже парсит oid 1186), писать только сериализатор. Рядом с (8) — тот же приём |
| 15 | `f.binary`, `f.inet` | — |
| 16 | Удаление `min`/`max` | **Строго после `plans/validation.md`** |
| 17 | `enum` | Нужен `CREATE TYPE` в DDL |

---

## 8. Открытые вопросы

Продуктовые и архитектурные вопросы закрыты (см. R5, R7). Остались технические:

1. **`db_type` вне primary — свободная строка или enum?** Дизайн A снимает гейт
   `if (f.type === 'primary')`, и тогда опечатка в `db_type` обычного поля уедет
   в DDL как несуществующий тип. Нужен либо allowlist, либо громкая ошибка на
   неизвестное значение (сводятся к B7).
2. **`Duration` без арифметики — приемлемо ли?** Решение принято: значений
   достаточно для чтения и записи, но `d1 + d2` невозможно. Если понадобится
   арифметика, ей нужна опорная дата (`d.addTo(date)`) — это отдельный тип.
3. **`Decimal` в `dependencies` core меняет публичную поверхность пакета.**
   `Decimal` попадёт в `~shape` пользователей, то есть тип из чужого пакета
   становится частью их API. Согласовано осознанно, но вспомнить при первом
   релизе.

---

## Связанные файлы

- `packages/core/src/ir/index.ts:13` — `FieldType`
- `packages/core/src/model/compile.ts:147` — `normalizeType()`
- `packages/core/src/model/fields/index.ts` — объект `f`, ровно 6 точек входа
- `packages/core/src/model/fields/primary.ts:86` — дефолтный `f.pk` = bigint
- `packages/core/src/model/fields/number.ts` — `int`/`decimal`, мёртвые `min`/`max`
- `packages/core/src/model/fields/datetime.ts` — три времени, `_validate`
- `packages/core/src/model/types/number.d.ts:13` — `tsType: 'number'` → добавится `'Decimal'`
- `packages/core/src/model/types/_base.d.ts:10` — `db_type`, рядом появится `tz`
- `packages/core/src/model/compile.ts:33` — копирование флага из `db` в `spec`
- `packages/core/src/orm/field-builders/factory.ts:51` — выбор фильтра, переезд на `tsType`
- `packages/core/src/orm/field-builders/filters.ts` — `NumberFilter`, база для `Decimal`/`bigintString`
- `packages/core/src/orm/builders/utils.ts:15` — `mapRow()`, будущий coercion
- `packages/core/src/orm/builders/select.ts:476` — обходит `mapRow`, надо подключить
- `packages/core/src/codegen/generate-model.ts:85` — ref → `number`
- `packages/sql-pg/src/index.ts:40` — переопределение парсера oid 20, снимается
- `packages/sql-pg/src/ddl-adapter.ts:78` — интроспекция, теряет длину → `format_type`
- `packages/sql-pg/src/diff/types.ts:152` — `pgType`
- `packages/sql-pg/src/diff/types.ts:193` — `normalizePgType`, убрать `startsWith('varchar')` (строка 200)
- `packages/sql-pg/src/diff/types.ts:213` — `renderDefault`
- `node_modules/pg/lib/utils.js:44-83` — `prepareValue`/`prepareObject`, источник B11
- `node_modules/pg-types/lib/textParsers.js:199` — `register(1186, parseInterval)`, чтение `interval` уже бесплатно
- `plans/validation.md` — потребитель матрицы `tsType`, гейт для удаления `min`/`max`
