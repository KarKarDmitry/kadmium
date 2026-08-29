# Kadmium TODO

Приоритеты: 🔴 Critical | 🟡 Medium | 🟢 Low | 💅 Cosmetic

---

## 🔴 Priority 1 — Fix before production

### ~~1.1 Double-release connection pool при ошибке COMMIT~~ ✅

**Проблема:** `TransactionalPgAdapter.commit()` в `finally` блоке вызывает
`this.client.release()`. Если `COMMIT` падает — клиент отпущен в пул. Затем
`OrmManager.transaction()` вызывает `txAdapter.rollback()`, который тоже имеет
`finally { this.client.release() }`. Double-release разрушает состояние пула
соединений.

**Решение:** Добавлен guard `_released: boolean` в `TransactionalPgAdapter`.
`commit()` и `rollback()` проверяют флаг перед `release()`. Добавлен метод
`end()`, который вызывается в `finally` блока `transaction()`.

**Плюсы:** Пул соединений не разрушается при ошибках COMMIT. Жизненный цикл
клиента управляется `transaction()`, а не адаптером.

- `packages/sql-pg/src/index.ts` — `_released` guard + `end()`
- `packages/core/src/orm/orm.ts` — `finally { txAdapter.end() }`

---

### ~~1.2 BETWEEN рендерится как один параметр~~ ✅

**Проблема:** `NumberFilter.between(a, b)` создаёт `WhereCondition` с
`op: 'BETWEEN'` и `value: [a, b]`. `_renderValue()` не обрабатывал BETWEEN —
массив пушился как одно значение. PostgreSQL получал `field BETWEEN $1` с
`$1 = [a, b]` вместо `field BETWEEN $1 AND $2`.

**Решение:** Добавлен case для `BETWEEN` в `_renderValue()` — пушит два
отдельных параметра и возвращает `$1 AND $2`.

**Плюсы:** BETWEEN-фильтры работают корректно с параметризованными запросами.

- `packages/sql-pg/src/sql-generator.ts` — `_renderValue()`, новый case

---

### ~~1.3 Кодогенерация: declare module ведёт в несуществующий файл для наследников~~ ✅

**Проблема:** Если класс-наследник определён в том же файле, что и родитель
(например, `Post_posts extends Post` в `post.ts`), кодогенератор строил путь из
`ir.name` — `post_posts` → `src/models/post_posts`. Файла не существует, module
augmentation не применялся.

**Решение:** Добавлено `ModelIR.sourceFile` — путь к исходному файлу модели.
Кодогенератор использует `ir.sourceFile` вместо конструирования из имени.
`ModelImporter` хранит sourceFile с приоритетом конкретного файла над
`index.ts`.

**Плюсы:** Augment для классов-наследников работает корректно. Модели,
ре-экспортированные через `index.ts`, не теряют путь к исходному файлу.

- `packages/core/src/ir/index.ts` — `ModelIR.sourceFile`
- `packages/core/src/core/model-importer.ts` — приоритет sourceFile
- `packages/core/src/cli/generate.ts` — использует `ir.sourceFile`
- `packages/core/src/codegen/runner.ts` — удалён дублирующий console.log

---

### ~~1.4 Путь импорта в augment строится из lowercased имени модели~~ ✅

**Проблема:** Кодогенератор строил путь из `ir.name` (lowercased). Если модель
называется не по имени файла, путь импорта был неверным.

**Решение:** Решено вместе с 1.3 — теперь используется `ir.sourceFile` (реальный
путь к файлу, где определён класс).

**Плюсы:** Путь импорта всегда соответствует реальному файлу модели.

---

### ~~1.5 Наследование моделей ломает inverse refs в ~rel~~ ✅

**Проблема:** Если класс B extends A, `$refs()` на B ищет обратные связи ТОЛЬКО
по `B.name`. Все inverse refs, указывающие на A, терялись. `Post_posts` не
получал `comments` от `Post`.

**Решение:** В `compileModel()` добавлен проход по prototype chain. Если у
модели есть родительский класс (не `Model`), его inverse refs добавляются к IR
наследника.

```ts
const ParentCtor = Object.getPrototypeOf(model.constructor);
if (ParentCtor && ParentCtor !== Model) {
  const parentRefs = new (ParentCtor as new () => Model)().$refs();
  for (const rel of parentRefs) {
    if (!refs.find((r) => r.field === rel.field)) refs.push(rel);
  }
}
```

**Плюсы:** Наследование моделей работает корректно — `~rel` содержит все связи,
включая унаследованные от родителя.

- `packages/core/src/ir/compile.ts` — prototype chain traversal
- ✅ `Post_posts['~rel']` теперь содержит
  `{ author?: User; comments: Comment[] }`

---

## 🟡 Priority 2 — Architecture debt

### ~~2.1 AppCore — God-объект с 6 ответственностями~~ ✅

**Проблема:** `AppCore` одновременно загружал конфиг, сканировал ФС, динамически
импортировал модули, определял принадлежность к Model, компилировал IR и
валидировал целостность.

**Решение:** Разделение на три класса + фасад:

| Класс           | Файл                | Ответственность                            |
| --------------- | ------------------- | ------------------------------------------ |
| `ConfigLoader`  | `config-loader.ts`  | поиск и загрузка `kadmium.config.*`        |
| `ModelImporter` | `model-importer.ts` | glob, import, фильтрация по `MODEL_MARKER` |
| `ModelRegistry` | `model-registry.ts` | регистрация, IR, кеш, валидация            |
| `AppCore`       | `app-core.ts`       | фасад, делегирует трём классам             |

`generate.ts` теперь использует `ConfigLoader` + `ModelImporter` напрямую — без
дублирования логики импорта.

**Плюсы:**

- Тестируемость — можно замокать `ModelImporter` без ФС
- Переиспользование — `generate.ts` не дублирует импорт
- Single responsibility — каждый класс легко менять без риска сломать остальное

- `packages/core/src/core/config-loader.ts` — новый файл
- `packages/core/src/core/model-importer.ts` — новый файл
- `packages/core/src/core/model-registry.ts` — новый файл
- `packages/core/src/core/app-core.ts` — фасад
- `packages/core/src/cli/generate.ts` — использует `ConfigLoader` +
  `ModelImporter`

---

### ~~2.2 isModelClass() инстанцирует произвольные функции~~ ✅

**Проблема:** `isModelClass()` вызывал `new (fn as new () => unknown)()` для
каждого экспортированного function из файла модели. Функции с побочными
эффектами в конструкторе выполнялись, а ошибки молча проглатывались.

**Решение:** Заменён на статический маркер:

```ts
export const MODEL_MARKER = Symbol.for('kadmium:model');
class Model {
  static [MODEL_MARKER] = true;
}
function isModelClass(fn) {
  return typeof fn === 'function' && (fn as any)[MODEL_MARKER] === true;
}
```

**Плюсы:** Никаких побочных эффектов при сканировании. Безопасно для функций с
конструкторами, подключающимися к БД.

- `packages/core/src/model/index.ts` — `MODEL_MARKER`
- `packages/core/src/core/app-core.ts` — `isModelClass()` через маркер
- `packages/core/src/core/model-importer.ts` — `_isModelClass()` через маркер

---

### 2.3 Correlated subqueries для includes (N+1-like) ⏳ **Отложено**

**Проблема:** `_buildIncludeSubquery()` генерирует correlated subquery для
каждой связи. Для каждой строки основной таблицы — отдельный подзапрос. На 10k
записей с 2 include = 20k подзапросов.

**План:** Переход на `LEFT JOIN LATERAL` для to-one, один LEFT JOIN +
группировка на клиенте для to-many. Требует реальных данных для тестирования.

---

### ~~2.4 Transaction — commit() не должен вызывать release()~~ ✅

**Проблема:** `commit()` и `rollback()` сами управляли `this.client.release()`.
При ошибке COMMIT клиент отпускался в пул, затем rollback делал double-release.

**Решение:** Решено совместно с 1.1. Добавлен guard `_released`. Вызов `end()` в
`finally` блока `transaction()` гарантирует единоразовый release.

**Плюсы:** Предсказуемый жизненный цикл клиента. Безопасность при ошибках.

- `packages/sql-pg/src/index.ts` — `_released` guard
- `packages/core/src/orm/orm.ts` — `finally` блок

---

## 🟢 Priority 3 — Code quality

### ~~3.1 Убрать fallback SQL-рендеринг из toSql()~~ ✅

**Проблема:** `SingleQueryBuilder.toSql()` и `MultiQueryBuilder.toSql()`
содержали собственную генерацию SQL без адаптера. Значения вставлялись
конкатенацией без экранирования — гарантия расхождения с реальной
SQL-генерацией.

**Решение:** Если адаптер не установлен — `throw new Error()`.

**Плюсы:** Единый источник правды для SQL-генерации — `SqlGenerator` в sql-pg.

- `packages/core/src/orm/builders/single.ts` — `toSql()` без fallback
- `packages/core/src/orm/builders/multi.ts` — `toSql()` без fallback

---

### ~~3.2 ModuleSlot — нет cleanup callback'ов~~ ✅

**Проблема:** `onSet()` добавлял callback в массив, но никогда их не удалял. При
горячей перезагрузке или повторной инициализации callbacks накапливались.

**Решение:** `onSet()` теперь возвращает функцию отписки:

```ts
onSet(cb): () => void {
  this._setCallbacks.push(cb);
  return () => {
    const idx = this._setCallbacks.indexOf(cb);
    if (idx !== -1) this._setCallbacks.splice(idx, 1);
  };
}
```

**Плюсы:** Безопасно для hot-reload. Потребитель сам управляет временем жизни
подписки.

- `packages/core/src/core/modules.ts` — `onSet()` возвращает unsubscribe

---

### ~~3.3 Добавить end() в интерфейс SqlAdapter~~ ✅

**Проблема:** `PgAdapter` не предоставлял публичного метода для закрытия пула. В
`cli/db.ts` использовался `(adapter as any).close()` — хак.

**Решение:** Добавлен опциональный `end?(): Promise<void>` в `SqlAdapter`.
Реализован на `PgAdapter`. В `db.ts` вызывается `adapter.end?.()`.

**Плюсы:** Безопасный вызов без `as any`. Единый интерфейс для всех адаптеров.

- `packages/sql-types/src/index.ts` — `end?()` в `SqlAdapter`
- `packages/sql-pg/src/index.ts` — `PgAdapter.end()`
- `packages/core/src/cli/db.ts` — `adapter.end?.()`

---

### ~~3.4 Поправить `StandartField` → `StandardField`~~ ✅

**Проблема:** Опечатка "Standart" вместо "Standard".

**Решение:** Rename через IDE. Breaking change для публичного API.

**Плюсы:** Корректное имя в публичном API.

- `packages/core/src/model/types/_base.ts` — `StandardField`

---

### ~~3.5 Удалить мёртвый код~~ ✅

**Файл:** `packages/core/src/model/fields/index.ts` — удалён комментарий
`// const l = f.datetime.date.;`

---

### ~~3.6 `_test.ts` не должен быть в src~~ ✅

**Файл:** `packages/core/src/_test.ts` — удалён. Тесты в `test-project/`.

---

## 💅 Future / Nice to have

### 4.1 Вынести параметризованные типы в отдельный d.ts

Типы `FilterProxy`, `SelectProxy`, `MultiFilterProxy`, `FinalResult` и т.д. (в
`types/proxy.ts` и `types/relations.ts`) составляют ~60% объёма ORM-слоя по
строкам. При компиляции каждого файла, использующего Kadmium, TypeScript
разворачивает их заново.

**Решение:** Вынести публичные типы в `.d.ts` с
`export * from './types/relations'` — улучшит скорость компиляции для
потребителей библиотеки.

---

### 4.2 Тесты на IR-компиляцию

Написать тесты, которые проверяют:

- Компиляция модели с ref-полем даёт корректный `FieldIR` с `ref`, `relation`,
  `foreignKey`
- Инверсные связи (обратные рефы) правильно добавляются в IR
- Наследование не теряет поля родителя
- primary-поле определяется корректно для `findById()`

---

### 4.3 Миграция с commonjs на ESM

`tsconfig.base.json` использует `"module": "commonjs"`. TypeScript 6.0+ и
Node.js LTS уже хорошо поддерживают ESM. Для библиотеки, которая использует
динамические импорты (`import(file)`), ESM дал бы больше предсказуемости.

---

### ➕ Дополнительно сделано (вне TODO)

#### Table naming: snake_case через `ModelIR.collection`

**Проблема:** DDL создавал таблицы как `"post"` (lowercase), а SQL генератор
обращался к `"Post"` (PascalCase). Имена с составными словами (`UserPreference`)
теряли границы: `toLowerCase()` → `userpreference`.

**Решение:** Добавлено `ModelIR.collection` — snake_case имя таблицы,
вычисляемое через `toSnakeCase()` (`UserPreference` → `user_preference`). Все
слои (DDL, SQL генератор, include subqueries) используют `ir.collection`.

**Плюсы:** Единое именование таблиц. Snake_case для всех моделей.

- `packages/core/src/ir/index.ts` — `toSnakeCase()` + `collection`

#### Shortcuts: `count()`, `exists()`, `findById()`, `page()`

**Проблема:** Для простых операций (подсчёт записей, проверка существования,
поиск по PK, пагинация) нужно было писать много boilerplate.

**Решение:** Добавлены методы на `SingleQueryBuilder`:

- `count()` — `SELECT COUNT(*) AS "count"`
- `exists()` — `SELECT ... LIMIT 1`, проверка `results.length > 0`
- `findById(id)` — `WHERE pk.eq(id).first()`, типизирован под тип PK
- `page(p, size)` — `LIMIT size OFFSET (p-1)*size`

**Плюсы:** Меньше кода для типовых операций.

#### Typed `go()` + `Evaluate<T>` для читаемых типов

**Проблема:** `go()` возвращал `Promise<any[]>`, хотя `select()` уже имел
типизированный TResult. IDE показывала
`IncludeResult<Post, [ToOneRelationBuilder<...>]>` вместо конкретного объекта.

**Решение:** Типизирован `go()` через `IncludeResult<TModel, R>`. Добавлен
`Evaluate<T>` для форсирования eager evaluation типов.

**Плюсы:** IDE показывает конкретные поля вместо generic-цепочки.
