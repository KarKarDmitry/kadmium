/**
 * ModuleSlot — слот для DI модулей.
 * Позволяет установить адаптер и получить его.
 */
export class ModuleSlot<T> {
  private _value: T | null = null;
  private _setCallbacks: Array<(val: T) => void> = [];

  /** Установить модуль */
  set(value: T): void {
    this._value = value;
    for (const cb of this._setCallbacks) cb(value);
  }

  /** Получить модуль */
  get(): T | null {
    return this._value;
  }

  /** Проверить, установлен ли модуль */
  get has(): boolean {
    return this._value !== null;
  }

  /** Подписаться на установку. Возвращает функцию отписки. */
  onSet(cb: (val: T) => void): () => void {
    if (this._value) cb(this._value);
    this._setCallbacks.push(cb);
    return () => {
      const idx = this._setCallbacks.indexOf(cb);
      if (idx !== -1) this._setCallbacks.splice(idx, 1);
    };
  }
}
