// ── Utility types ──

/** Форсирует eager evaluation — IDE показывает конкретный объект, а не generic */
export type Evaluate<T> = { [K in keyof T]: T[K] } & {};
