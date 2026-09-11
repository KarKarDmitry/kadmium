/**
 * SqlGenerator — генерация PostgreSQL SQL из ReadonlySqb.
 * Адаптировано из старого kadmium-core.
 */
import type {
  ReadonlySqb,
  WhereCondition,
  WhereGroup,
  WhereExpression,
  SelectItem,
  IncludedRelation,
} from '@karkardmitry/kadmium-sql-types';

/** Ссылка на поле (для field-to-field сравнений) */
interface SqlIdentifierRef {
  getIdentifierForSql(): string;
}

/**
 * ON CONFLICT (target) DO UPDATE/NOTHING для INSERT.
 * Обновляются все ключи, кроме входящих в conflictTarget.
 */
export function renderConflictClause(
  keys: string[],
  conflictTarget: string[],
  doNothing: boolean,
): string {
  const target = conflictTarget.map((c) => `"${c}"`).join(', ');
  if (doNothing) return ` ON CONFLICT (${target}) DO NOTHING`;
  const updateCols = keys
    .filter((k) => !conflictTarget.includes(k))
    .map((k) => `"${k}" = EXCLUDED."${k}"`)
    .join(', ');
  return updateCols
    ? ` ON CONFLICT (${target}) DO UPDATE SET ${updateCols}`
    : ` ON CONFLICT (${target}) DO NOTHING`;
}

/** Whitelist операторов сравнения, интерполируемых в SQL (S5: runtime guard против SQL-инъекций). */
export const VALID_OPS = new Set<string>([
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'LIKE',
  'ILIKE',
  'IN',
  'BETWEEN',
  'IS NULL',
  'IS NOT NULL',
]);

export abstract class SqlGenerator {
  /** Преобразует значение WhereCondition в SQL-строку + параметры */
  protected _renderValue(
    w: WhereCondition,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    // field-to-field сравнение
    if (
      w.value &&
      typeof w.value === 'object' &&
      'getIdentifierForSql' in w.value
    ) {
      return (w.value as SqlIdentifierRef).getIdentifierForSql();
    }
    // null / undefined
    if (w.value === null || w.value === undefined) {
      return 'NULL';
    }
    // IN
    if (w.op === 'IN' && Array.isArray(w.value)) {
      if (w.value.length === 0) return '1=0';
      const vals = w.value.map(() => `$${paramIndex.p++}`).join(', ');
      values.push(...w.value);
      return `IN (${vals})`;
    }
    // BETWEEN
    if (w.op === 'BETWEEN' && Array.isArray(w.value) && w.value.length === 2) {
      values.push(w.value[0], w.value[1]);
      return `$${paramIndex.p++} AND $${paramIndex.p++}`;
    }
    // Обычное значение
    values.push(w.value);
    return `$${paramIndex.p++}`;
  }

  /** Рендерит WHERE дерево (группа = последовательность шагов). */
  protected _buildWhereGroupSql(
    group: WhereGroup,
    values: unknown[],
    paramIndex: { p: number },
    resolveBare?: (col: string) => string,
  ): string {
    if (group.elements.length === 0) return '';
    const parts = group.elements.map((step, i) => {
      const condSql = this._renderWhereExpression(
        step.condition,
        values,
        paramIndex,
        resolveBare,
        step.join,
        group.elements.length > 1,
      );
      return i === 0 ? condSql : `${step.join} ${condSql}`;
    });
    return parts.join(' ');
  }

  /** Собирает "левая_часть оператор правая_часть" с allowlist-валидацией (S5); IS-операторы — без правой части (TG11). */
  protected _renderCondition(
    left: string,
    w: WhereCondition,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    if (!VALID_OPS.has(w.op)) {
      throw new Error(`Unsupported operator: ${w.op}`);
    }
    if (w.op === 'IS NULL' || w.op === 'IS NOT NULL') {
      return `${left} ${w.op}`;
    }
    const right = this._renderValue(w, values, paramIndex);
    return `${left} ${w.op} ${right}`;
  }

  /**
   * Рендер одного выражения-условия. Минимальные скобки: группа выводится
   * в скобках только если её uniform-join не совпадает с join текущего шага
   * (или она смешанная) и у родителя есть соседние шаги, с которыми могла бы
   * перепутаться ассоциативность.
   */
  private _renderWhereExpression(
    expression: WhereExpression,
    values: unknown[],
    paramIndex: { p: number },
    resolveBare: ((col: string) => string) | undefined,
    contextJoin: 'AND' | 'OR',
    hasSiblings: boolean,
  ): string {
    if (!('elements' in expression)) {
      const col = expression.column ?? expression.field;
      const left = expression.alias
        ? `"${expression.alias}"."${col}"`
        : (resolveBare?.(col) ?? `"${col}"`);
      return this._renderCondition(left, expression, values, paramIndex);
    }
    const inner = this._buildWhereGroupSql(
      expression,
      values,
      paramIndex,
      resolveBare,
    );
    if (inner === '') return '';
    const uniform = expression.elements[0]?.join;
    const mixed = expression.elements.some((e) => e.join !== uniform);
    const needsParens = mixed || uniform !== contextJoin;
    return needsParens && hasSiblings ? `(${inner})` : inner;
  }

  /** Рендерит WHERE clause целиком */
  protected _buildWhereClause(
    rootGroup: WhereGroup,
    values: unknown[],
    paramIndex: { p: number },
    extraConditions: string[],
  ): string {
    const mainSql = this._buildWhereGroupSql(rootGroup, values, paramIndex);
    const all = [mainSql, ...extraConditions].filter(Boolean);
    return all.length === 0 ? '' : `WHERE ${all.join(' AND ')}`;
  }

  /** Рендерит одно условие (для JOIN ON) */
  protected _buildConditionSql(
    w: WhereCondition,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    const col = w.column ?? w.field;
    const left = w.alias ? `"${w.alias}"."${col}"` : `"${col}"`;
    return this._renderCondition(left, w, values, paramIndex);
  }

  /**
   * HAVING: агрегатные алиасы из SELECT резолвятся в полные выражения,
   * т.к. Postgres не позволяет ссылаться на выходные алиасы в HAVING.
   * Формат выражения совпадает с AggregateField.toSql() без AS-части.
   */
  protected _buildHavingClause(
    sqb: ReadonlySqb,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    if (sqb.havings.elements.length === 0) return '';
    const aggAliases = new Map<string, string>();
    for (const sel of sqb.selects ?? []) {
      if (sel.kind === 'aggregate' && sel.alias && sel.func) {
        const inner =
          sel.fieldName === '*'
            ? '*'
            : `"${sel.tableAlias}"."${sel.fieldName}"`;
        aggAliases.set(sel.alias, `${sel.func.toUpperCase()}(${inner})`);
      }
    }
    return this._buildWhereGroupSql(sqb.havings, values, paramIndex, (col) =>
      aggAliases.get(col) === undefined ? `"${col}"` : aggAliases.get(col)!,
    );
  }

  // ═══ INCLUDE как correlated subquery ═══

  protected _buildSubquerySelectClause(
    alias: string,
    selects: readonly SelectItem[] | null,
    targetFields: { name: string; column: string }[],
  ): string {
    if (selects && selects.length > 0) {
      return selects
        .map((sel) => {
          if (sel.kind === 'aggregate') return sel.toSql();
          const col = sel.column ?? sel.fieldName;
          return `"${alias}"."${col}" AS "${sel.alias || sel.fieldName}"`;
        })
        .join(', ');
    }
    // Все поля: каждый алиасится префиксом `alias.` для последующей распаковки
    if (targetFields.length === 0)
      targetFields = [{ name: 'id', column: 'id' }];
    return targetFields
      .map((tf) => `"${alias}"."${tf.column}" AS "${alias}.${tf.name}"`)
      .join(', ');
  }

  protected _buildSubqueryModifiers(
    alias: string,
    orders: readonly {
      field: string;
      column?: string;
      direction: 'asc' | 'desc';
    }[],
    limit: number | null,
    offset: number | null,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    const parts: string[] = [];
    if (orders.length > 0) {
      parts.push(
        `ORDER BY ${orders.map((o) => `"${alias}"."${o.column ?? o.field}" ${o.direction.toUpperCase()}`).join(', ')}`,
      );
    }
    if (limit !== null) {
      parts.push(`LIMIT $${paramIndex.p++}`);
      values.push(limit);
    }
    if (offset !== null) {
      parts.push(`OFFSET $${paramIndex.p++}`);
      values.push(offset);
    }
    return parts.join(' ');
  }

  /**
   * Рендерит include как LEFT JOIN LATERAL вместо коррелированного подзапроса
   * в SELECT. LATERAL позволяет планировщику строить совместный план (см. P1).
   *
   * Возвращает фрагменты:
   *  - from:   `LEFT JOIN LATERAL (SELECT <json> ...) AS "<__inc_<prop>>" ON true`
   *  - select: `"<__inc_<prop>>"."<prop>" AS "<prop>"`
   * Форма результата (json-колонка с именем свойства) сохраняется, поэтому
   * распаковка вложенных include на клиенте не меняется.
   */
  protected _buildInclude(
    inc: IncludedRelation,
    correlationCondition: WhereCondition,
    values: unknown[],
    paramIndex: { p: number },
  ): { from: string; select: string } {
    const alias = inc.propertyName;
    const lateralAlias = `__inc_${alias}`;
    const relatedSqb = inc.internalSqb;
    const collectionName = inc.targetIr.collection;

    // Внутренний SELECT: поля цели + вложенные include (рекурсивно)
    let innerSelect = this._buildSubquerySelectClause(
      alias,
      relatedSqb.selects,
      Object.entries(inc.targetIr.fields ?? {})
        .filter(([, f]) => !f.sourceModel)
        .map(([name, f]) => ({
          name,
          column: f.alias ?? name,
        })),
    );
    let innerFrom = `FROM "${collectionName}" AS "${alias}"`;
    for (const nested of relatedSqb.includes) {
      const nestedCond: WhereCondition = {
        alias: nested.propertyName,
        field: nested.childField,
        op: '=',
        value: {
          getIdentifierForSql: () =>
            `"${nested.parentAlias}"."${nested.parentField}"`,
        },
      };
      const nestedLateral = this._buildInclude(
        nested,
        nestedCond,
        values,
        paramIndex,
      );
      innerFrom += ` ${nestedLateral.from}`;
      innerSelect += `, ${nestedLateral.select}`;
    }

    // WHERE: пользовательский + correlation
    const subqueryWheres: WhereGroup = {
      elements: [
        ...relatedSqb.wheres.elements,
        { join: 'AND', condition: correlationCondition },
      ],
    };
    const whereClause = this._buildWhereClause(
      subqueryWheres,
      values,
      paramIndex,
      [],
    );

    const modifiers = this._buildSubqueryModifiers(
      alias,
      relatedSqb.orders,
      relatedSqb.limit,
      relatedSqb.offset,
      values,
      paramIndex,
    );

    const subQueryText =
      `SELECT ${innerSelect} ${innerFrom} ${whereClause} ${modifiers}`
        .trim()
        .replace(/\s+/g, ' ');

    const jsonExpr =
      inc.relationType === 'one-to-many'
        ? `COALESCE(json_agg(subq), '[]'::json)`
        : `row_to_json(subq)`;

    return {
      from: `LEFT JOIN LATERAL (SELECT ${jsonExpr} AS "${alias}" FROM (${subQueryText}) AS subq) AS "${lateralAlias}" ON true`,
      select: `"${lateralAlias}"."${alias}" AS "${alias}"`,
    };
  }

  // ═══ JOIN building ═══

  private _buildJoinGraph(
    joins: readonly { left: string; right: string }[],
  ): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const j of joins) {
      if (!graph.has(j.left)) graph.set(j.left, []);
      if (!graph.has(j.right)) graph.set(j.right, []);
      graph.get(j.left)!.push(j.right);
      graph.get(j.right)!.push(j.left);
    }
    return graph;
  }

  private _findJoinIslands(
    graph: Map<string, string[]>,
    allAliases: string[],
  ): Set<string>[] {
    const visited = new Set<string>();
    const islands: Set<string>[] = [];
    for (const alias of allAliases) {
      if (visited.has(alias)) continue;
      const island = new Set<string>();
      const queue = [alias];
      visited.add(alias);
      island.add(alias);
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const neighbor of graph.get(current) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            island.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      islands.push(island);
    }
    return islands;
  }

  // ═══ Main query builders ═══

  public toSql(sqb: ReadonlySqb): { text: string; values: unknown[] } {
    const values: unknown[] = [];
    const paramIndex = { p: 1 };

    switch (sqb.operation) {
      case 'select':
        return {
          text: this._buildSelectQueryText(sqb, values, paramIndex),
          values,
        };
      case 'update':
        return this._buildUpdateQuery(sqb);
      case 'delete':
        return this._buildDeleteQuery(sqb);
      case 'upsert':
        return this._buildUpsertQuery(sqb);
      default:
        throw new Error(`Operation "${sqb.operation}" not implemented`);
    }
  }

  private _buildSelectQueryText(
    sqb: ReadonlySqb,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    const mainTableAlias = this._mainTableAlias(sqb);

    // SELECT clause: поля/агрегаты + INCLUDE laterals как доп. select-item-ы
    let selectClause = this._buildSelectFields(sqb, mainTableAlias);
    const includes = this._buildIncludesClauses(
      sqb,
      mainTableAlias,
      values,
      paramIndex,
    );
    if (includes.select) selectClause += `, ${includes.select}`;

    // FROM: JOIN-острова + LATERAL joins включаемых отношений
    const { from, extraConditions } = this._buildFromJoins(
      sqb,
      values,
      paramIndex,
    );
    const fromClause = [from, includes.from].filter(Boolean).join(' ');

    // Per-clause: WHERE (курсор + OR-группировка) / GROUP BY / HAVING / ORDER BY / LIMIT-OFFSET
    const whereClause = this._buildSelectWhereClause(
      sqb,
      values,
      paramIndex,
      extraConditions,
    );
    const groupByClause = this._buildGroupByClause(sqb, mainTableAlias);
    let havingClause = '';
    const havingSql = this._buildHavingClause(sqb, values, paramIndex);
    if (havingSql) havingClause = `HAVING ${havingSql}`;
    const orderByClause = this._buildOrderByClause(sqb, mainTableAlias);
    const paginationClause = this._buildPaginationClause(
      sqb,
      values,
      paramIndex,
    );

    return `SELECT\n\t${selectClause}\nFROM ${fromClause}\n\t${whereClause}\n${groupByClause}\n${havingClause}\n${orderByClause}\n${paginationClause}`
      .trim()
      .replace(/\s+/g, ' ');
  }

  /** Алиас главной таблицы из tableContext. */
  private _mainTableAlias(sqb: ReadonlySqb): string {
    const mainTableAlias = [...sqb.tableContext.keys()][0];
    if (!mainTableAlias) throw new Error('No table context');
    return mainTableAlias;
  }

  /** SELECT-лист: поля/агрегаты из sqb.selects, иначе `"alias".*`. */
  private _buildSelectFields(sqb: ReadonlySqb, mainTableAlias: string): string {
    if (!sqb.selects || sqb.selects.length === 0) {
      return `"${mainTableAlias}".*`;
    }
    const isMultiTable = sqb.tableContext.size > 1;
    return sqb.selects
      .map((sel) => {
        // AggregateField (count/sum/avg/min/max)
        if (sel.kind === 'aggregate') {
          return sel.toSql();
        }
        const col = sel.column ?? sel.fieldName;
        const id = sel.tableAlias ? `"${sel.tableAlias}"."${col}"` : `"${col}"`;
        if (sel.alias) return `${id} AS "${sel.alias}"`;
        if (isMultiTable && sel.tableAlias)
          return `${id} AS "${sel.tableAlias}.${sel.fieldName}"`;
        return `${id} AS "${sel.fieldName}"`;
      })
      .join(', ');
  }

  /** INCLUDE subqueries (LEFT JOIN LATERAL): select-item + from-хвост. */
  private _buildIncludesClauses(
    sqb: ReadonlySqb,
    mainTableAlias: string,
    values: unknown[],
    paramIndex: { p: number },
  ): { select: string; from: string } {
    let select = '';
    const froms: string[] = [];
    for (const inc of sqb.includes) {
      const includeParentAlias = inc.parentAlias || mainTableAlias;
      const cond: WhereCondition = {
        alias: inc.propertyName,
        field: inc.childField,
        op: '=',
        value: {
          // Field reference — для field-to-field сравнения
          // Используем parentAlias из include (для multi-запросов)
          getIdentifierForSql: () =>
            `"${includeParentAlias}"."${inc.parentField}"`,
        },
      };
      const lateral = this._buildInclude(inc, cond, values, paramIndex);
      select += `, ${lateral.select}`;
      froms.push(lateral.from);
    }
    return { select, from: froms.join(' ') };
  }

  /** FROM: LEFT/RIGHT/INNER JOIN-острова; возвращает доп. WHERE-условия для полностью-соединённых рёбер. */
  private _buildFromJoins(
    sqb: ReadonlySqb,
    values: unknown[],
    paramIndex: { p: number },
  ): { from: string; extraConditions: string[] } {
    const allAliases = [...sqb.tableContext.keys()];
    const joinGraph = this._buildJoinGraph(sqb.joins);
    const joinIslands = this._findJoinIslands(joinGraph, allAliases);
    let fromClause = '';
    const extraWhereConditions: string[] = [];

    for (const island of joinIslands) {
      const islandAliases = [...island];
      const islandTablesInFrom = new Set<string>();
      const joinsForIsland = sqb.joins.filter(
        (j) => island.has(j.left) && island.has(j.right),
      );
      const processedJoins = new Set<object>();

      const firstAlias = islandAliases[0];
      let islandFromClause = `FROM "${sqb.tableContext.get(firstAlias)}" AS "${firstAlias}"`;
      islandTablesInFrom.add(firstAlias);

      let tablesAddedInPass = true;
      while (tablesAddedInPass) {
        tablesAddedInPass = false;
        for (const join of joinsForIsland) {
          if (processedJoins.has(join)) continue;
          let newAlias: string | undefined;
          if (
            islandTablesInFrom.has(join.left) &&
            !islandTablesInFrom.has(join.right)
          )
            newAlias = join.right;
          else if (
            !islandTablesInFrom.has(join.left) &&
            islandTablesInFrom.has(join.right)
          )
            newAlias = join.left;
          else if (
            islandTablesInFrom.has(join.left) &&
            islandTablesInFrom.has(join.right)
          ) {
            if (join.on && !('elements' in join.on)) {
              extraWhereConditions.push(
                this._buildConditionSql(join.on, values, paramIndex),
              );
            }
            processedJoins.add(join);
            continue;
          }
          if (newAlias && join.on && !('elements' in join.on)) {
            const onSql = this._buildConditionSql(join.on, values, paramIndex);
            islandFromClause += ` ${(join.direction || 'inner').toUpperCase()} JOIN "${sqb.tableContext.get(newAlias)}" AS "${newAlias}" ON ${onSql}`;
            islandTablesInFrom.add(newAlias);
            processedJoins.add(join);
            tablesAddedInPass = true;
          }
        }
      }
      if (!fromClause)
        fromClause = islandFromClause.substring(5); // remove 'FROM '
      else fromClause += `, ${islandFromClause.substring(5)}`;
    }
    return { from: fromClause, extraConditions: extraWhereConditions };
  }

  /**
   * WHERE для SELECT: главная группа (OR-части оборачиваются в скобки),
   * курсор — отдельный AND-член; + экстра-условия из JOIN-графа.
   */
  private _buildSelectWhereClause(
    sqb: ReadonlySqb,
    values: unknown[],
    paramIndex: { p: number },
    extraConditions: string[],
  ): string {
    if (
      sqb.wheres.elements.length === 0 &&
      sqb.cursor.elements.length === 0 &&
      extraConditions.length === 0
    ) {
      return '';
    }
    const mainSql = this._buildWhereGroupSql(sqb.wheres, values, paramIndex);
    const hasOr = sqb.wheres.elements.some((s) => s.join === 'OR');
    const main = hasOr && mainSql !== '' ? `(${mainSql})` : mainSql;
    let cursorSql = '';
    if (sqb.cursor.elements.length > 0) {
      const cursorInner = this._buildWhereGroupSql(
        sqb.cursor,
        values,
        paramIndex,
      );
      cursorSql = cursorInner === '' ? '' : `(${cursorInner})`;
    }
    const all = [main, cursorSql, ...extraConditions].filter(Boolean);
    return `WHERE ${all.join(' AND ')}`;
  }

  private _buildGroupByClause(
    sqb: ReadonlySqb,
    mainTableAlias: string,
  ): string {
    if (sqb.groupBy.length === 0) return '';
    return `GROUP BY ${sqb.groupBy
      .map((f) => `"${mainTableAlias}"."${f}"`)
      .join(', ')}`;
  }

  private _buildOrderByClause(
    sqb: ReadonlySqb,
    mainTableAlias: string,
  ): string {
    if (sqb.orders.length === 0) return '';
    return `ORDER BY ${sqb.orders
      .map(
        (o) =>
          `"${mainTableAlias}"."${o.column ?? o.field}" ${o.direction.toUpperCase()}`,
      )
      .join(', ')}`;
  }

  private _buildPaginationClause(
    sqb: ReadonlySqb,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    let limitClause = '';
    if (sqb.limit !== null) {
      limitClause = `LIMIT $${paramIndex.p++}`;
      values.push(sqb.limit);
    }
    let offsetClause = '';
    if (sqb.offset !== null) {
      offsetClause = `OFFSET $${paramIndex.p++}`;
      values.push(sqb.offset);
    }
    return `${limitClause} ${offsetClause}`.trim();
  }

  // ═══ UPDATE ═══

  private _buildUpdateQuery(sqb: ReadonlySqb): {
    text: string;
    values: unknown[];
  } {
    if (sqb.tableContext.size !== 1)
      throw new Error('UPDATE requires exactly one table');
    const collectionName = sqb.tableContext.values().next().value;
    const tableAlias = sqb.tableContext.keys().next().value;
    const values: unknown[] = [];
    const paramIndex = { p: 1 };
    const data = sqb.updateData;

    if (!data || Object.keys(data).length === 0)
      throw new Error('No data provided for UPDATE');

    const setClause = Object.keys(data)
      .map((key) => {
        values.push(data[key]);
        return `"${key}" = $${paramIndex.p++}`;
      })
      .join(', ');

    const whereClause = this._buildWhereClause(
      sqb.wheres,
      values,
      paramIndex,
      [],
    );

    const returningClause =
      sqb.selects && sqb.selects.length > 0
        ? sqb.selects.map((sel) => sel.toSql()).join(', ')
        : '*';

    return {
      text: `UPDATE "${collectionName}" AS "${tableAlias}" SET ${setClause} ${whereClause} RETURNING ${returningClause}`
        .trim()
        .replace(/\s+/g, ' '),
      values,
    };
  }

  // ═══ UPSERT ═══

  private _buildUpsertQuery(sqb: ReadonlySqb): {
    text: string;
    values: unknown[];
  } {
    if (sqb.tableContext.size !== 1)
      throw new Error('UPSERT requires exactly one table');
    const collectionName = sqb.tableContext.values().next().value;
    const data = sqb.upsertData;

    if (!data || Object.keys(data).length === 0)
      throw new Error('No data provided for UPSERT');

    const keys = Object.keys(data);
    const columns = keys.map((k) => `"${k}"`).join(', ');
    const values: unknown[] = [];
    const paramIndex = { p: 1 };
    const placeholders = keys
      .map((k) => {
        values.push(data[k]);
        return `$${paramIndex.p++}`;
      })
      .join(', ');

    let onConflict = '';
    if (sqb.conflictTarget?.length) {
      onConflict = renderConflictClause(
        keys,
        sqb.conflictTarget,
        sqb.doNothing,
      );
    }

    return {
      text: `INSERT INTO "${collectionName}" (${columns}) VALUES (${placeholders})${onConflict} RETURNING *`
        .trim()
        .replace(/\s+/g, ' '),
      values,
    };
  }

  // ═══ DELETE ═══

  private _buildDeleteQuery(sqb: ReadonlySqb): {
    text: string;
    values: unknown[];
  } {
    if (sqb.tableContext.size !== 1)
      throw new Error('DELETE requires exactly one table');
    const collectionName = sqb.tableContext.values().next().value;
    const tableAlias = sqb.tableContext.keys().next().value;
    const values: unknown[] = [];
    const paramIndex = { p: 1 };
    const whereClause = this._buildWhereClause(
      sqb.wheres,
      values,
      paramIndex,
      [],
    );

    const returningClause =
      sqb.selects && sqb.selects.length > 0
        ? sqb.selects.map((sel) => sel.toSql()).join(', ')
        : '*';

    return {
      text: `DELETE FROM "${collectionName}" AS "${tableAlias}" ${whereClause} RETURNING ${returningClause}`
        .trim()
        .replace(/\s+/g, ' '),
      values,
    };
  }
}
