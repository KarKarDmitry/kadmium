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

      // Получить или создать вложенный объект под ключом `key`
      const child = (key: string): Record<string, unknown> => {
        const cur = nestedRow[key];
        if (!cur || typeof cur !== 'object' || Array.isArray(cur)) {
          nestedRow[key] = {};
        }
        return nestedRow[key] as Record<string, unknown>;
      };

      for (const sel of selects) {
        if (sel.kind !== 'selectable') continue;
        const tableAlias = sel.tableAlias;
        const resultName =
          sel.alias ||
          (tableAlias ? `${tableAlias}.${sel.fieldName}` : sel.fieldName);
        const propertyName = sel.alias || sel.fieldName;

        if (tableAlias) {
          if (flatRow[resultName] !== undefined) {
            child(tableAlias)[propertyName] = flatRow[resultName];
          }
        } else {
          nestedRow[propertyName] = flatRow[resultName];
        }
      }

      for (const incl of includes) {
        const propertyName = incl.propertyName;
        if (flatRow[propertyName] !== undefined) {
          child(incl.parentAlias)[propertyName] = flatRow[propertyName];
        }
      }

      return nestedRow;
    });
  }
}
