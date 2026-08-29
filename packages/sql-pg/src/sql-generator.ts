/**
 * SqlGenerator — генерация PostgreSQL SQL из ReadonlySqb.
 * Адаптировано из старого kadmium-core.
 */
import type {
  ReadonlySqb,
  WhereCondition,
  WhereGroup,
  SelectableField,
  IncludedRelation,
} from '@karkardmitry/kadmium-sql-types';

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
      'getIdentifierForSql' in (w.value as any)
    ) {
      return (w.value as any).getIdentifierForSql();
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

  /** Рендерит WHERE дерево */
  protected _buildWhereGroupSql(
    group: WhereGroup,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    if (group.conditions.length === 0) return '';
    const parts = group.conditions.map((c) => {
      if ('conditions' in c) {
        return `(${this._buildWhereGroupSql(c, values, paramIndex)})`;
      }
      const left = c.alias ? `"${c.alias}"."${c.field}"` : `"${c.field}"`;
      const right = this._renderValue(c, values, paramIndex);
      return `${left} ${c.op} ${right}`;
    });
    return parts.join(` ${group.op} `);
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
    const left = w.alias ? `"${w.alias}"."${w.field}"` : `"${w.field}"`;
    const right = this._renderValue(w, values, paramIndex);
    return `${left} ${w.op} ${right}`;
  }

  // ═══ INCLUDE как correlated subquery ═══

  protected _buildSubquerySelectClause(
    alias: string,
    selects: readonly SelectableField[] | null,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    if (selects && selects.length > 0) {
      return selects
        .map((sel) => {
          if (sel.aggregate) {
            // Агрегаты пока не поддерживаем
            return `${sel.aggregate.toUpperCase()}(${sel.fieldName === '*' ? '*' : `"${alias}"."${sel.fieldName}"`}) AS "${sel.alias || sel.fieldName}"`;
          }
          return `"${alias}"."${sel.fieldName}" AS "${sel.alias || sel.fieldName}"`;
        })
        .join(', ');
    }
    // Все поля: хотябы id
    return `"${alias}"."id" AS "${alias}.id"`;
  }

  protected _buildSubqueryModifiers(
    alias: string,
    orders: readonly { field: string; direction: 'asc' | 'desc' }[],
    limit: number | null,
    offset: number | null,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    const parts: string[] = [];
    if (orders.length > 0) {
      parts.push(
        `ORDER BY ${orders.map((o) => `"${alias}"."${o.field}" ${o.direction.toUpperCase()}`).join(', ')}`,
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

  protected _buildIncludeSubquery(
    inc: IncludedRelation,
    correlationCondition: WhereCondition,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    const alias = inc.propertyName;
    const relatedSqb = inc.internalSqb;
    const collectionName = inc.targetIr.collection;

    const selectClause = this._buildSubquerySelectClause(
      alias,
      relatedSqb.selects,
      values,
      paramIndex,
    );

    // WHERE: пользовательский + correlation
    const subqueryWheres: WhereGroup = {
      op: 'AND',
      conditions: [...relatedSqb.wheres.conditions, correlationCondition],
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
      `SELECT ${selectClause} FROM "${collectionName}" AS "${alias}" ${whereClause} ${modifiers}`
        .trim()
        .replace(/\s+/g, ' ');

    if (inc.relationType === 'one-to-many') {
      return `(SELECT COALESCE(json_agg(subq), '[]'::json) FROM (${subQueryText}) AS subq) AS "${alias}"`;
    }
    // ToOne
    return `(SELECT row_to_json(subq) FROM (${subQueryText}) AS subq) AS "${alias}"`;
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
      default:
        throw new Error(`Operation "${sqb.operation}" not implemented`);
    }
  }

  private _buildSelectQueryText(
    sqb: ReadonlySqb,
    values: unknown[],
    paramIndex: { p: number },
  ): string {
    const mainTableAlias = [...sqb.tableContext.keys()][0];
    if (!mainTableAlias) throw new Error('No table context');

    // SELECT clause
    let selectClause = '';
    if (sqb.selects && sqb.selects.length > 0) {
      const isMultiTable = sqb.tableContext.size > 1;
      selectClause = sqb.selects
        .map((sel: any) => {
          // AggregateField (count/sum/avg/min/max)
          if (sel.kind === 'aggregate') {
            return sel.toSql();
          }
          const id = sel.tableAlias
            ? `"${sel.tableAlias}"."${sel.fieldName}"`
            : `"${sel.fieldName}"`;
          if (sel.alias) return `${id} AS "${sel.alias}"`;
          if (isMultiTable && sel.tableAlias)
            return `${id} AS "${sel.tableAlias}.${sel.fieldName}"`;
          return `${id} AS "${sel.fieldName}"`;
        })
        .join(', ');
    } else {
      selectClause = `"${mainTableAlias}".*`;
    }

    // INCLUDE subqueries
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
      selectClause += `, ${this._buildIncludeSubquery(inc, cond, values, paramIndex)}`;
    }

    // FROM + JOIN islands
    const allAliases = [...sqb.tableContext.keys()];
    const joinGraph = this._buildJoinGraph(sqb.joins);
    const joinIslands = this._findJoinIslands(joinGraph, allAliases);
    let fromClause = '';
    const extraWhereConditions: string[] = [];

    for (const island of joinIslands) {
      const islandAliases = [...island];
      const islandTablesInFrom = new Set<string>();
      let islandFromClause = '';
      const joinsForIsland = sqb.joins.filter(
        (j) => island.has(j.left) && island.has(j.right),
      );
      const processedJoins = new Set<object>();

      const firstAlias = islandAliases[0];
      islandFromClause = `FROM "${sqb.tableContext.get(firstAlias)}" AS "${firstAlias}"`;
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
            if (join.on && !('conditions' in join.on)) {
              extraWhereConditions.push(
                this._buildConditionSql(join.on, values, paramIndex),
              );
            }
            processedJoins.add(join);
            continue;
          }
          if (newAlias && join.on && !('conditions' in join.on)) {
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

    // WHERE
    const whereClause = this._buildWhereClause(
      sqb.wheres,
      values,
      paramIndex,
      extraWhereConditions,
    );

    // GROUP BY
    let groupByClause = '';
    if (sqb.groupBy.length > 0) {
      groupByClause = `GROUP BY ${sqb.groupBy.map((f) => `"${mainTableAlias}"."${f}"`).join(', ')}`;
    }

    // ORDER BY
    let orderByClause = '';
    if (sqb.orders.length > 0) {
      orderByClause = `ORDER BY ${sqb.orders
        .map(
          (o) =>
            `"${mainTableAlias}"."${o.field}" ${o.direction.toUpperCase()}`,
        )
        .join(', ')}`;
    }

    // LIMIT / OFFSET
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

    return `SELECT ${selectClause} FROM ${fromClause} ${whereClause} ${groupByClause} ${orderByClause} ${limitClause} ${offsetClause}`
      .trim()
      .replace(/\s+/g, ' ');
  }

  // ═══ UPDATE ═══

  private _buildUpdateQuery(sqb: ReadonlySqb): {
    text: string;
    values: unknown[];
  } {
    if (sqb.tableContext.size !== 1)
      throw new Error('UPDATE requires exactly one table');
    const collectionName = sqb.tableContext.values().next().value;
    const values: unknown[] = [];
    const paramIndex = { p: 1 };
    const data = sqb.updateData;

    if (!data || Object.keys(data).length === 0)
      throw new Error('No data provided for UPDATE');

    const setClause = Object.keys(data)
      .map((key) => {
        values.push((data as any)[key]);
        return `"${key}" = $${paramIndex.p++}`;
      })
      .join(', ');

    const whereClause = this._buildWhereClause(
      sqb.wheres,
      values,
      paramIndex,
      [],
    );

    return {
      text: `UPDATE "${collectionName}" SET ${setClause} ${whereClause} RETURNING *`
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
    const values: unknown[] = [];
    const paramIndex = { p: 1 };
    const whereClause = this._buildWhereClause(
      sqb.wheres,
      values,
      paramIndex,
      [],
    );

    return {
      text: `DELETE FROM "${collectionName}" ${whereClause}`
        .trim()
        .replace(/\s+/g, ' '),
      values,
    };
  }
}
