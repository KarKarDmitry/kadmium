/**
 * FuncField — базовый класс функции в SELECT (агрегат, оконная функция).
 * Несёт phantom-тип TResult для type-level инференса результата.
 * Данные только: SQL-рендером занимается адаптер (структурный паттерн WhereCondition).
 */
export abstract class FuncField<TResult = unknown> {
  public abstract readonly kind: 'aggregate' | 'window';
  public alias: string = '';
  /**
   * Phantom для type-level инференса результата.
   * GetFieldType читает его по ключу (S['~result']) — indexed access надёжен
   * даже когда alias добавлен intersection'ом (.as() что-то вроде
   * `AggregateField<number> & { alias: 'cnt' }`), тогда как `infer T`
   * на intersection'е разворачивается в `number | unknown = unknown`.
   */
  declare readonly '~result': TResult;

  constructor(
    public readonly func: string,
    /** '*'' для COUNT(*) или поле для SUM(field) */
    public readonly field: { tableAlias: string; fieldName: string } | '*',
  ) {}

  /** Совместимость с SelectItem интерфейсом из sql-types */
  get tableAlias(): string {
    return this.field === '*' ? '' : this.field.tableAlias;
  }
  get fieldName(): string {
    return this.field === '*' ? '*' : this.field.fieldName;
  }

  /** Переименовать функцию в SELECT (возвращает новый инстанс) */
  abstract as<A extends string>(alias: A): FuncField<TResult> & { alias: A };
}
