/**
 * ResultReshaper — трансформирует flat-результаты PostgreSQL
 * в nested структуру для multi-table запросов.
 */
export class ResultReshaper {
  static reshape(
    flatRows: Record<string, unknown>[],
    selects: any[],
    includes: any[],
  ): Record<string, unknown>[] {
    return flatRows.map((flatRow) => {
      const nestedRow: Record<string, any> = {};

      for (const sel of selects) {
        if (sel.kind === 'selectable') {
          const tableAlias = sel.tableAlias as string | undefined;
          const resultName = sel.alias || (tableAlias
            ? `${tableAlias}.${sel.fieldName}`
            : sel.fieldName);
          const propertyName = sel.alias || sel.fieldName;

          if (tableAlias) {
            if (!nestedRow[tableAlias]) nestedRow[tableAlias] = {};
            if (flatRow[resultName] !== undefined) {
              nestedRow[tableAlias][propertyName] = flatRow[resultName];
            }
          } else {
            nestedRow[propertyName] = flatRow[resultName];
          }
        }
      }

      for (const incl of includes) {
        const parentAlias = incl.parentAlias;
        const propertyName = incl.propertyName;
        if (flatRow[propertyName] !== undefined) {
          if (!nestedRow[parentAlias]) nestedRow[parentAlias] = {};
          nestedRow[parentAlias][propertyName] = flatRow[propertyName];
        }
      }

      return nestedRow;
    });
  }
}
