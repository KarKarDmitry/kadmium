/**
 * ResultReshaper — трансформирует flat-результаты PostgreSQL
 * в nested структуру для multi-table запросов.
 */
import type {
  SelectItem,
  IncludedRelation,
} from '@karkardmitry/kadmium-sql-types';

export class ResultReshaper {
  static reshape(
    flatRows: Record<string, unknown>[],
    selects: readonly SelectItem[],
    includes: readonly IncludedRelation[],
  ): Record<string, unknown>[] {
    return flatRows.map((flatRow) => {
      const nestedRow: Record<string, unknown> = {};

      const child = (key: string): Record<string, unknown> => {
        const cur = nestedRow[key];
        if (!cur || typeof cur !== 'object' || Array.isArray(cur)) {
          nestedRow[key] = {};
        }
        return nestedRow[key] as Record<string, unknown>;
      };

      for (const sel of selects) {
        const tableAlias = sel.tableAlias;
        const resultName =
          sel.alias ||
          (tableAlias ? `${tableAlias}.${sel.fieldName}` : sel.fieldName);
        const propertyName = sel.alias || sel.fieldName;

        if (sel.kind === 'selectable') {
          if (tableAlias) {
            if (flatRow[resultName] !== undefined) {
              child(tableAlias)[propertyName] = flatRow[resultName];
            }
          } else {
            nestedRow[propertyName] = flatRow[resultName];
          }
        } else {
          // aggregate / window: SQL-алиас без табличного префикса — верхний уровень
          if (flatRow[resultName] !== undefined) {
            nestedRow[resultName] = flatRow[resultName];
          }
        }
      }

      for (const incl of includes) {
        if (flatRow[incl.propertyName] !== undefined) {
          child(incl.parentAlias)[incl.propertyName] =
            flatRow[incl.propertyName];
        }
      }

      return nestedRow;
    });
  }
}
