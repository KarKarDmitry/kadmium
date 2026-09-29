import type { JoinOptions, KadmiumSqb } from './sqb';

/**
 * Гарды целостности SQB для DML-операций и multi-select.
 *
 * Зачем: sql-pg при рендере UPDATE/DELETE/INSERT читает только данные
 * и wheres — limit/offset/order/groupBy/cursor молча отбрасываются
 * (`_buildUpdateQuery`, `_buildDeleteQuery`, `buildInsertSql`).
 * Для SELECT-аналога такой проблемы нет, там каждый шаг доходит до SQL.
 * Результат: `.limit(1).delete()` тихо удаляет все подходящие строки,
 * а `.where(...).create(...)` тихо теряет фильтр. Гарды ловят это
 * в точке, где операция объявляется (update/delete/create/createMany/
 * select), а не в терминале — тогда ошибка указывает на строку,
 * породившую запрос, и с prepared-запросами не всплывает в горячем
 * цикле `orm.run().fill().go()`.
 *
 * Структура: приватный слой — чистые O(1) предикаты по одному полю,
 * публичный — имя операции + имя шага, собирает сообщение.
 * Текст ошибки строится только в ветке throw (никаких аллокаций
 * на проходе проверки).
 *
 * Чего гарды НЕ делают: не требуют `where` для update/delete
 * (продуктовое решение, а не техническое), не обходят AST
 * (только прямые чтения полей), не проверяют согласованность,
 * которую уже ловит система типов на handle-ветках.
 */

/** Поля sqb, которые sql-pg не рендерит в UPDATE/DELETE/INSERT. */
type DmlSqB = Pick<
  KadmiumSqb,
  'limit' | 'offset' | 'orders' | 'groupBy' | 'cursor' | 'wheres'
>;

/** Поля sqb, которые читает join-гард. */
type JoinsSqB = Pick<KadmiumSqb, 'joins'>;

/**
 * Алиас таблицы селекта, если он вообще есть.
 * В списке селектов лежат не только SelectableField: FuncField
 * (агрегаты — tableAlias пустой) и SqlSelectable (sql-фрагмент — поля
 * tableAlias нет вовсе). Оба легальны и проверку проходят, поэтому
 * читаем алиас duck-типингом, а не через типизированный доступ.
 */
function aliasOf(item: unknown): string {
  const alias = (item as { tableAlias?: unknown }).tableAlias;
  return typeof alias === 'string' ? alias : '';
}

/** Поля, из-за которых операция молча теряет смысл. */
type BrokenStep = 'limit' | 'order' | 'groupBy' | 'where';

// ─── приватный слой: предикаты ───

/** limit/offset — limit() пишет только limit, page() и offset() пишут оба. */
function hasLimitOrOffset(sqb: DmlSqB): boolean {
  return sqb.limit !== null || sqb.offset !== null;
}

/** orders + cursor: порядок строк и keyset-пагинация — управление выбором. */
function hasOrdering(sqb: DmlSqB): boolean {
  return sqb.orders.length > 0 || sqb.cursor.elements.length > 0;
}

function hasGroupBy(sqb: DmlSqB): boolean {
  return sqb.groupBy.length > 0;
}

function hasWhere(sqb: DmlSqB): boolean {
  return sqb.wheres.elements.length > 0;
}

/**
 * Уже объявлен JOIN с этой парой алиасов и этим направлением.
 * Направление сравниваем через `?? 'inner'`: in-memory sqb всегда пишет
 * его явно, но ручной/клонированный AST мог сохранить undefined.
 */
function hasDuplicateJoin(
  sqb: JoinsSqB,
  left: string,
  right: string,
  direction: NonNullable<JoinOptions['direction']>,
): boolean {
  return sqb.joins.some(
    (j) =>
      j.left === left &&
      j.right === right &&
      (j.direction ?? 'inner') === direction,
  );
}

/**
 * Алиасы селектов, которых нет в запросе. Без алиаса — легально, пропускаем.
 * `known` — итерируемый источник (irs.keys()), поэтому материализуем его
 * один раз: и для поиска, и для текста сообщения — иначе повторный проход
 * по итератору дал бы пустой список.
 */
function unknownAliases(
  items: readonly unknown[],
  known: Iterable<string>,
): { unknown: string[]; known: string[] } {
  const knownList = [...known];
  const aliases = new Set(knownList);
  const unknown: string[] = [];
  for (const item of items) {
    const alias = aliasOf(item);
    if (alias && !aliases.has(alias) && !unknown.includes(alias)) {
      unknown.push(alias);
    }
  }
  return { unknown, known: knownList };
}

// ─── приватный слой: сообщения ───

/** Почему шаг не работает в этой операции + что делать вместо него. */
const STEP_HINT: Record<BrokenStep, string> = {
  limit:
    'PostgreSQL UPDATE/DELETE/INSERT have no LIMIT — the adapter drops it silently.',
  order:
    'ORDER BY does not exist in UPDATE/DELETE/INSERT — the adapter drops it silently.',
  groupBy:
    'GROUP BY is meaningless without aggregates — the adapter drops it silently.',
  where: 'INSERT has no WHERE clause — the filter is dropped silently.',
};

const STEP_METHOD: Record<BrokenStep, string> = {
  limit: 'limit()/page()/offset()',
  order: 'order()/cursor()',
  groupBy: 'groupBy()',
  where: 'where()',
};

/** Собирает сообщение. Вызывается только из ветки throw. */
function fail(op: string, step: BrokenStep, remedy: string): never {
  throw new Error(
    `${STEP_METHOD[step]} is not supported with ${op}().\n${STEP_HINT[step]} ${remedy}`,
  );
}

/** Шаги, которыми сужают выбор строк перед пишущей операцией. */
const NARROW_REMEDY =
  'Narrow the rows with where() instead, or run the update/delete on a select that returns ids first.';

const GROUP_REMEDY =
  'Aggregate on a select first, then update/delete the resulting rows by id.';

const INSERT_WHERE_REMEDY =
  'INSERT is unconditional — check the condition in your code before calling create(), or use update() on existing rows.';

// ─── публичный слой: операция + шаг ───

/**
 * UPDATE без limit/offset.
 * `.limit(1).update({...})` удалило бы/обновило все подходящие строки.
 */
export function assertDmlUpdateNoLimit(sqb: DmlSqB): void {
  if (hasLimitOrOffset(sqb)) fail('update', 'limit', NARROW_REMEDY);
}

/** UPDATE без order/cursor — порядок строк в пишущей операции не определён. */
export function assertDmlUpdateNoOrder(sqb: DmlSqB): void {
  if (hasOrdering(sqb)) fail('update', 'order', NARROW_REMEDY);
}

/** UPDATE без groupBy — группировка без агрегатов бессмысленна. */
export function assertDmlUpdateNoGroupBy(sqb: DmlSqB): void {
  if (hasGroupBy(sqb)) fail('update', 'groupBy', GROUP_REMEDY);
}

/** DELETE без limit/offset — `.limit(1).delete()` удалил бы все строки. */
export function assertDmlDeleteNoLimit(sqb: DmlSqB): void {
  if (hasLimitOrOffset(sqb)) fail('delete', 'limit', NARROW_REMEDY);
}

/** DELETE без order/cursor. */
export function assertDmlDeleteNoOrder(sqb: DmlSqB): void {
  if (hasOrdering(sqb)) fail('delete', 'order', NARROW_REMEDY);
}

/** DELETE без groupBy. */
export function assertDmlDeleteNoGroupBy(sqb: DmlSqB): void {
  if (hasGroupBy(sqb)) fail('delete', 'groupBy', GROUP_REMEDY);
}

/**
 * INSERT без limit/offset.
 * `buildInsertSql` не читает ничего, кроме данных, — пагинация молча пропала бы.
 */
export function assertDmlInsertNoLimit(sqb: DmlSqB): void {
  if (hasLimitOrOffset(sqb)) fail('create', 'limit', INSERT_WHERE_REMEDY);
}

/** INSERT без order/cursor. */
export function assertDmlInsertNoOrder(sqb: DmlSqB): void {
  if (hasOrdering(sqb)) fail('create', 'order', INSERT_WHERE_REMEDY);
}

/** INSERT без groupBy. */
export function assertDmlInsertNoGroupBy(sqb: DmlSqB): void {
  if (hasGroupBy(sqb)) fail('create', 'groupBy', INSERT_WHERE_REMEDY);
}

/** INSERT без where — самая коварная форма: фильтр исчезает, строка создаётся всегда. */
export function assertDmlInsertNoWhere(sqb: DmlSqB): void {
  if (hasWhere(sqb)) fail('create', 'where', INSERT_WHERE_REMEDY);
}

/**
 * Селект ссылается на алиас, которого нет в запросе.
 * MultiSelectProxy отдаёт поле с column=undefined вместо ошибки
 * (multi.ts `_createSelectProxy`), и запрос падает в PostgreSQL (42P01)
 * строкой ниже по стеку и в другом файле.
 */
export function assertSelectAliasKnown(
  items: readonly unknown[],
  known: Iterable<string>,
): void {
  const { unknown, known: knownList } = unknownAliases(items, known);
  if (unknown.length === 0) return;
  const list = knownList.join(', ');
  const hint =
    list.length > 0
      ? ` Query tables are: ${list}.`
      : ' The query has no tables.';
  throw new Error(
    `Unknown table alias${unknown.length > 1 ? 'es' : ''} ` +
      `${unknown.map((a) => `"${a}"`).join(', ')} in select().${hint} ` +
      `Check the aliases passed to orm.query({...}).`,
  );
}

/**
 * Повторный join() той же пары алиасов и направления.
 *
 * Раньше дубликат молча пропускался (C11): второй `on` не добавлялся
 * в AST, но и вызов не ошибался — условие соединения исчезало без следа,
 * и запрос расходился с задуманным. JOIN без `on` в SQL не соберётся
 * (адаптер добавляет только пары с условием), поэтому тихий пропуск
 * маскировал опечатку в алиасах/направлении.
 */
export function assertNoDuplicateJoin(
  sqb: JoinsSqB,
  left: string,
  right: string,
  direction: NonNullable<JoinOptions['direction']>,
): void {
  if (!hasDuplicateJoin(sqb, left, right, direction)) return;
  throw new Error(
    `join() on ${left} ↔ ${right} (${direction}) is already declared.\n` +
      `A duplicate JOIN is rejected instead of dropped silently — the second on() condition would disappear. ` +
      `Reuse the existing join() and add the extra condition to where(), or drop the previous call.`,
  );
}

/**
 * Все проверки одной операции разом.
 * Порядок соответствует порядку вызова шагов в билдере, чтобы
 * сообщение указывало на первый несовместимый шаг.
 */
export function assertDmlUpdate(sqb: DmlSqB): void {
  assertDmlUpdateNoLimit(sqb);
  assertDmlUpdateNoOrder(sqb);
  assertDmlUpdateNoGroupBy(sqb);
}

/** @see assertDmlUpdate */
export function assertDmlDelete(sqb: DmlSqB): void {
  assertDmlDeleteNoLimit(sqb);
  assertDmlDeleteNoOrder(sqb);
  assertDmlDeleteNoGroupBy(sqb);
}

/** @see assertDmlUpdate */
export function assertDmlInsert(sqb: DmlSqB): void {
  assertDmlInsertNoLimit(sqb);
  assertDmlInsertNoOrder(sqb);
  assertDmlInsertNoGroupBy(sqb);
  assertDmlInsertNoWhere(sqb);
}
