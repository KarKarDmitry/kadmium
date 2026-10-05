/**
 * Приведение значений при чтении (B3/B4).
 *
 * PostgreSQL отдаёт `int8` и `numeric` строкой: у `numeric` в `pg-types` нет
 * парсера, а `int8` парсится в `number` мимо всякой проверки. Раньше это
 * чинилось на стороне адаптера, и обе правки были неверными:
 *
 * - `Number()` на oid 20 **молча** округляет значения выше 2^53 — снежинка
 *   Discord превращается в соседнее число, и расхождение видно только в
 *   данных;
 * - `numeric` приезжает строкой вопреки `~shape`, который обещает `number`.
 *
 * Здесь приведение живёт в core, потому что только core знает IR: адаптеру
 * достаётся `sqb`, где `IncludedRelation.targetIr` — сужённый minimal-shape
 * без `tsType`. Поэтому план строится один раз на билдере и едет в
 * `CompiledQuery.coerce` готовым, а на горячем пути `run().fill().go()`
 * применяется без единого обращения к IR.
 *
 * Правило одно: **молча терять разряды нельзя**. Всё, что в `number` не
 * помещается, бросает ошибку с именем модели и колонки — см. B3/B4 в
 * `plans/data-types.md`.
 */

import type {
  CoercionColumn,
  CoercionGuard,
  CoercionNode,
  IncludedRelation,
  SelectItem,
  SqlSelectItem,
} from '@karkardmitry/kadmium-sql-types';
import type { FieldIR, ModelIR } from '../../ir/index';

export type { CoercionNode };

/**
 * Сколько значащих десятичных цифр double хранит точно.
 *
 * 15, а не 16: `Number.MAX_SAFE_INTEGER` — это 16 цифр, но для дробных
 * значений (`0.1 + 0.2 !== 0.3`) граница уже на 15. Проверка по цифрам, а не
 * через round-trip `String(Number(x)) === x`, потому что PG отдаёт `10.500`,
 * и сравнение строк сочло бы это потерей точности.
 */
const MAX_SAFE_DIGITS = 15;

/** Резолв целевой модели по имени — тот же lookup, что у `BaseQueryBuilder`. */
export type IrLookup = (name: string) => ModelIR | undefined;

function primaryKeyOf(ir: ModelIR): FieldIR | undefined {
  return Object.values(ir.fields).find((f) => f.isPrimary === true);
}

/**
 * Категория SQL-типа, в который уезжает поле, — тем же маппингом, что
 * `pgType()` из `sql-pg/diff/types.ts`. Там решается, что уедет в DDL, здесь —
 * что придёт обратно. Адаптер не знает про core, а core не знает про
 * PostgreSQL, поэтому дублирование неизбежно; расходиться таблицы должны
 * только при правке обоих.
 *
 * `int4` и `int8` разделены не ради точности, а потому что из них PG считает
 * `sum` в разные типы (см. `guardForFunc`).
 */
type PgKind = 'int4' | 'int8' | 'numeric' | 'float' | 'text';

function pgKindOf(f: FieldIR, irLookup: IrLookup, depth = 0): PgKind {
  switch (f.type) {
    case 'number':
    case 'int':
      return 'int4';
    case 'bigint':
      return 'int8';
    case 'decimal':
    case 'numeric':
      return 'numeric';
    case 'float':
      return 'float';
    case 'primary': {
      // `f.pk` без уточнения уезжает в bigint (serial/bigserial), но `.string`
      // и `.uuid` переопределяют тип на строковый.
      const dbType = f.spec?.db_type as string | undefined;
      if (dbType === 'uuid' || dbType === 'string') return 'text';
      if (dbType === 'numeric') return 'numeric';
      return 'int8';
    }
    case 'ref': {
      // FK-колонка хранит PK цели, поэтому тип — тип её PK. Глубина
      // ограничена: реф на реф в DSL невозможен, а реф на саму себя —
      // вполне, и без счётчика это был бы цикл.
      if (depth >= 2) return 'int4';
      const target = f.ref ? irLookup(f.ref) : undefined;
      const pk = target ? primaryKeyOf(target) : undefined;
      return pk ? pgKindOf(pk, irLookup, depth + 1) : 'int4';
    }
    default:
      return 'text';
  }
}

/** Сторож по категории типа: `text` приводить нечего. */
function guardFromKind(kind: PgKind): CoercionGuard | null {
  switch (kind) {
    case 'int4':
    case 'int8':
      return 'integer';
    case 'numeric':
      return 'numeric';
    case 'float':
      return 'float';
    case 'text':
      return null;
  }
}

/** Сторож обычного поля — «приди ровно так, как объявлено в IR». */
function guardForField(f: FieldIR, irLookup: IrLookup): CoercionGuard | null {
  return guardFromKind(pgKindOf(f, irLookup));
}

/** Сколько значащих цифр в десятичной записи числа. */
function significantDigits(text: string): number {
  const digits = text.replace(/^[+-]/, '').replace(/[^0-9]/g, '');
  // Ведущие нули не значащие ('0.5' → '5'); хвостовые тоже ('10.500' → '1'),
  // иначе PG-формат с хвостовыми нулями выглядел бы как потеря точности.
  return digits.replace(/^0+/, '').replace(/0+$/, '').length;
}

/**
 * Привести одно значение.
 *
 * Идемпотентна: не-строка возвращается как есть. Это делает порядок
 * безразличным — пока адаптер приводит `int8` сам, ветка для него
 * превращается в no-op, и снять override можно отдельным коммитом, не
 * смешивая две правки.
 */
function coerceValue(raw: unknown, column: CoercionColumn): unknown {
  if (typeof raw !== 'string' || raw === '') return raw;
  const value = Number(raw);

  if (column.guard === 'float') return value;

  if (column.guard === 'integer') {
    if (Number.isSafeInteger(value)) return value;
    throw new Error(
      `Cannot read ${column.source} as a number: ${raw} is outside the safe ` +
        `integer range (|n| <= ${Number.MAX_SAFE_INTEGER}) and would be ` +
        `silently rounded by Number(). Use a string primary key ` +
        `(f.pk.uuid or f.pk.string) for identifiers this large.`,
    );
  }

  if (significantDigits(raw) <= MAX_SAFE_DIGITS) return value;
  throw new Error(
    `Cannot read ${column.source} as a number: ${raw} has more than ` +
      `${MAX_SAFE_DIGITS} significant digits, which a JS number cannot ` +
      `represent exactly. Keep ${MAX_SAFE_DIGITS} or fewer digits in a ` +
      `decimal/numeric column, or store the exact value in a string column.`,
  );
}

function coerceRowInPlace(
  row: Record<string, unknown>,
  node: CoercionNode,
): void {
  for (const column of node.columns) {
    const raw = row[column.prop];
    // `undefined` — колонки нет в результате (выключенная проекция), а не
    // значение, которое надо приводить.
    if (raw === undefined) continue;
    row[column.prop] = coerceValue(raw, column);
  }
  if (!node.includes) return;
  for (const [prop, child] of Object.entries(node.includes)) {
    const nested = row[prop];
    if (nested === undefined || nested === null) continue;
    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (item && typeof item === 'object') {
          coerceRowInPlace(item as Record<string, unknown>, child);
        }
      }
    } else if (typeof nested === 'object') {
      coerceRowInPlace(nested as Record<string, unknown>, child);
    }
  }
}

/**
 * Применить план к строкам. План меняет строки на месте и возвращает их же:
 * копия каждой строки на горячем пути стоила бы дороже самой приведения.
 *
 * `node === undefined` — приводить нечего, строки возвращаются как есть.
 */
export function applyCoercion<T>(
  node: CoercionNode | undefined,
  rows: T[],
): T[] {
  if (!node) return rows;
  for (const row of rows) {
    if (row && typeof row === 'object') {
      coerceRowInPlace(row as Record<string, unknown>, node);
    }
  }
  return rows;
}

/**
 * Сторож для агрегатной/оконной функции.
 *
 * Ключевое здесь — что Postgres **возвращает**, а не что лежит в поле.
 * Таблица сложений PostgreSQL не совпадает с типом аргумента, и на этом
 * уже ошибались:
 *
 * | функция            | int4 (f.number/int) | int8 (bigint) | numeric | float |
 * |--------------------|---------------------|---------------|---------|-------|
 * | `sum`              | bigint              | **numeric**   | numeric | float8|
 * | `avg`              | **numeric**         | **numeric**   | numeric | float8|
 * | `min`/`max`/`lag`  | как поле            | как поле      | как поле| как поле
 *
 * `avg` делит всегда, поэтому даже над `int4` отдаёт `numeric` — сторож
 * `integer` здесь ронял бы обычное скользящее среднее `7.5` как «вне
 * диапазона». `sum(int8)` тоже widening: int8 не переполняется, но и не
 * влезает в JS-число целиком, поэтому сторож `numeric`.
 *
 * `count` и rank-семейство всегда int8; их значения заведомо меньше 2^53,
 * но сторож остаётся — он стоит одну проверку.
 *
 * `null` — результат нечисловой (`min(text)`, `lag` над текстом): приводить
 * нечего.
 */
function guardForFunc(
  func: string,
  field: FieldIR | undefined,
  irLookup: IrLookup,
): CoercionGuard | null {
  switch (func) {
    case 'row_number':
    case 'rank':
    case 'dense_rank':
    case 'ntile':
    case 'count':
      return 'integer';
    case 'avg': {
      if (!field) return null;
      const kind = pgKindOf(field, irLookup);
      return kind === 'float' ? 'float' : 'numeric';
    }
    case 'sum': {
      if (!field) return null;
      switch (pgKindOf(field, irLookup)) {
        case 'int4':
          return 'integer';
        case 'float':
          return 'float';
        default:
          return 'numeric';
      }
    }
    default:
      // min/max/lag/lead/first_value/nth_value следуют за типом поля.
      return field ? guardForField(field, irLookup) : null;
  }
}

type IrLookupFn = IrLookup;

/** Селект, у которого в рантайме известен тип: всё, кроме сырого `sql`. */
type TypedSelectItem = Exclude<SelectItem, SqlSelectItem>;

function fieldOf(
  ir: ModelIR,
  sel: TypedSelectItem,
  irLookup: IrLookupFn,
): FieldIR | undefined {
  if (!sel.fieldName) return undefined;
  // Сначала модель, которой селект принадлежит по алиасу: в multi-запросе у
  // алиаса своя IR, и одноимённое поле другой модели сторожуется иначе.
  const owner = sel.tableAlias ? irLookup(sel.tableAlias) : undefined;
  return owner?.fields[sel.fieldName] ?? ir.fields[sel.fieldName];
}

function columnFor(
  ir: ModelIR,
  sel: TypedSelectItem,
  irLookup: IrLookupFn,
): CoercionColumn | null {
  const key = sel.alias ?? sel.fieldName;
  if (!key) return null;

  const field = fieldOf(ir, sel, irLookup);
  // Поле может не понадобиться: `count('*')` считает строки, а не колонку,
  // и тип результата задаёт сама функция. Но если поле есть, приводим только
  // то, что объявлено числом — строка/булево/Date уже приходят готовыми,
  // а `~shape` обещает ровно `tsType`.
  if (field && field.tsType !== 'number') return null;

  // У обычного поля `func` пуст — сторож берётся из самого поля. У агрегата и
  // окна тип задаёт функция (см. таблицу в `guardForFunc`), а поле нужно ей
  // только как аргумент.
  const func =
    sel.kind === 'aggregate' || sel.kind === 'window'
      ? sel.func
      : sel.kind === 'selectable'
        ? sel.aggregate
        : undefined;

  if (!field && !func) return null;

  const guard = func
    ? guardForFunc(func, field, irLookup)
    : guardForField(field as FieldIR, irLookup);
  if (!guard) return null;

  return {
    prop: key,
    tsType: 'number',
    guard,
    source: `${ir.name}.${sel.fieldName ?? func ?? '?'}`,
  };
}

function buildColumns(
  ir: ModelIR,
  selects: readonly SelectItem[] | null,
  irLookup: IrLookupFn,
): CoercionColumn[] {
  const columns: CoercionColumn[] = [];

  // `selects === null` — это `RETURNING *` у DML без `returning()`: колонки
  // приходят под именами колонок, и `mapRow` разложит их по пропами уже
  // ПОСЛЕ приведения. Обратная связь колонки не имеет, поэтому `sourceModel`
  // отсекается тем же предикатом, что и в `diff/expected.ts`.
  if (!selects) {
    for (const [prop, field] of Object.entries(ir.fields)) {
      if (field.sourceModel) continue;
      if (field.tsType !== 'number') continue;
      const guard = guardForField(field, irLookup);
      if (!guard) continue;
      columns.push({
        prop: field.alias ?? prop,
        tsType: 'number',
        guard,
        source: `${ir.name}.${prop}`,
      });
    }
    return columns;
  }

  for (const sel of selects) {
    // У `sql`-фрагмента типа в рантайме нет: он живёт в фантоме
    // (`declare '~result'`), который компилятор стирает. Такие колонки
    // приводятся только если пользователь объявил тег — см. `.tsType()`.
    if (sel.kind === 'sql-item') continue;
    const column = columnFor(ir, sel, irLookup);
    if (column) columns.push(column);
  }
  return columns;
}

/**
 * План приведения для запроса: корневая модель, её проекция и include'ы.
 *
 * Проекция включения берётся из `IncludedRelation.internalSqb.selects` — там
 * лежит полный подзапрос, поэтому вложенные колонки известны так же, как
 * корневые, и включая вложенные include'ы рекурсией.
 *
 * Возвращает `undefined`, когда приводить нечего — тогда и `applyCoercion`,
 * и `CompiledQuery.coerce` молчат, а не тащат пустой объект по всем путям.
 */
export function buildCoercionNode(
  ir: ModelIR,
  selects: readonly SelectItem[] | null,
  includedRelations: readonly IncludedRelation[],
  irLookup: IrLookupFn,
): CoercionNode | undefined {
  const columns = buildColumns(ir, selects, irLookup);

  let includes: Record<string, CoercionNode> | undefined;
  for (const rel of includedRelations) {
    const target = irLookup(rel.targetIr.name);
    if (!target) continue;
    const child = buildCoercionNode(
      target,
      rel.internalSqb.selects,
      rel.internalSqb.includes,
      irLookup,
    );
    if (!child) continue;
    includes ??= {};
    includes[rel.parentField] = {
      ...child,
      many: rel.relationType === 'one-to-many',
    };
  }

  if (columns.length === 0 && !includes) return undefined;
  return includes ? { columns, includes } : { columns };
}

/**
 * План приведения для multi-запроса.
 *
 * Строка multi-запроса — это `{ u: {...}, p: {...} }`, то есть те же
 * вложенные объекты, что и у include'ов, только по алиасам вместо имён
 * связей. Поэтому план собирается в корневой узел с пустыми `columns` и
 * `includes` по алиасам, а применитель не знает, куда он смотрит: обход
 * один и тот же.
 */
export function buildMultiCoercionNode(
  irs: ReadonlyMap<string, ModelIR>,
  selects: readonly SelectItem[] | null,
  includes: readonly IncludedRelation[],
  irLookup: IrLookupFn,
): CoercionNode | undefined {
  const byAlias: Record<string, CoercionNode> = {};

  for (const [alias, ir] of irs) {
    const own =
      selects?.filter((s) => s.kind !== 'sql-item' && s.tableAlias === alias) ??
      null;
    const ownIncludes = includes.filter((r) => r.parentAlias === alias);
    const node = buildCoercionNode(ir, own, ownIncludes, irLookup);
    if (node) byAlias[alias] = node;
  }

  if (Object.keys(byAlias).length === 0) return undefined;
  return { columns: [], includes: byAlias };
}
