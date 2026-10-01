import { describe, it, expect } from 'vitest';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { ModelIR } from '../../src/ir/index';
import { InsertBuilder } from '../../src/orm/builders/insert';
import { InsertManyBuilder } from '../../src/orm/builders/insert-many';
import { UpdateQueryBuilder } from '../../src/orm/builders/update';
import { sql, SqlFragment, SqlValue } from '../../src/orm/sql-fragment';
import type {
  InsertValuesData,
  SetData,
  SetValues,
} from '../../src/orm/types/dml-data';
import { makeMockAdapter, type MockAdapter } from './helpers';

/**
 * Модель со всеми видами колонок, которые важны для типизации `values()`:
 * NOT NULL без default (обязательна), NOT NULL с default (можно опустить),
 * nullable (можно опустить) и PK.
 *
 * `~defaults` продублирован вручную ровно так, как его выдаёт кодоген, —
 * тест проверяет контракт типов, а не кодоген (его тесты живут отдельно).
 */
type WidgetM = {
  ['~shape']: {
    id: number;
    sku: string;
    qty: number;
    label: string | undefined;
    note: string | undefined;
  };
  ['~defaults']: { id: number; qty: number };
  ['~rel']: Record<string, unknown>;
  ['~relInfo']: Record<string, unknown>;
};

function widgetIr(): ModelIR {
  return {
    name: 'Widget',
    collection: 'widgets',
    fields: {
      id: {
        type: 'bigint',
        alias: 'id',
        tsType: 'number',
        nullable: false,
        unique: true,
        index: false,
        isPrimary: true,
      },
      sku: {
        type: 'string',
        alias: 'sku',
        tsType: 'string',
        nullable: false,
        unique: true,
        index: false,
      },
      qty: {
        type: 'number',
        alias: 'qty',
        tsType: 'number',
        nullable: false,
        unique: false,
        index: false,
        spec: { default: 0 },
      },
      label: {
        type: 'string',
        alias: 'label',
        tsType: 'string',
        nullable: true,
        unique: false,
        index: false,
      },
      note: {
        type: 'string',
        alias: 'note',
        tsType: 'string',
        nullable: true,
        unique: false,
        index: false,
      },
    },
  };
}

function insert(adapter: MockAdapter) {
  return new InsertBuilder<WidgetM>(
    widgetIr(),
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

function insertMany(adapter: MockAdapter) {
  return new InsertManyBuilder<WidgetM>(
    widgetIr(),
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

function update(adapter: MockAdapter) {
  return new UpdateQueryBuilder<WidgetM>(
    widgetIr(),
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

/**
 * Типовые ассерты. `@ts-expect-error` проверяется `npm run check:type`: если
 * ошибка перестанет возникать, директива станет «unused» и сборка упадёт.
 */
describe('dml-data — типизация values()/set() по ~shape', () => {
  describe('InsertValuesData', () => {
    it('принимает только обязательные поля', () => {
      const data: InsertValuesData<WidgetM> = { sku: 'A-1' };
      expect(data).toEqual({ sku: 'A-1' });
    });

    it('defaulted и nullable поля можно опустить, можно передать', () => {
      const data: InsertValuesData<WidgetM> = {
        sku: 'A-1',
        qty: 5,
        label: 'x',
      };
      expect(data.qty).toBe(5);
    });

    it('принимает sql-фрагмент как значение', () => {
      // Фрагмент остаётся фрагментом на входе; в SqlValue его превращает
      // toSqlValue() внутри _mapData (проверяется в рантайм-тесте ниже).
      const data: InsertValuesData<WidgetM> = { sku: 'A-1', qty: sql`1 + 1` };
      expect(data.qty).toBeInstanceOf(SqlFragment);
    });

    it('null допустим только в nullable-колонке', () => {
      const data: InsertValuesData<WidgetM> = { sku: 'A-1', note: null };
      expect(data.note).toBe(null);

      // @ts-expect-error — sku NOT NULL: null здесь 23502 not_null_violation
      const bad: InsertValuesData<WidgetM> = { sku: null };
      expect(bad).toBeDefined();
    });

    it('NOT NULL без default обязателен', () => {
      // @ts-expect-error — нет sku: неполный INSERT упал бы в 23502
      const data: InsertValuesData<WidgetM> = { qty: 1 };
      expect(data).toBeDefined();
    });

    it('опечатка в ключе — ошибка компиляции, а не 42703 в рантайме', () => {
      // @ts-expect-error — поля `lable` в модели нет
      const data: InsertValuesData<WidgetM> = { sku: 'A-1', lable: 'x' };
      expect(data).toBeDefined();
    });

    it('неверный тип значения — ошибка компиляции, а не 22P02 в рантайме', () => {
      // @ts-expect-error — qty это number
      const data: InsertValuesData<WidgetM> = { sku: 'A-1', qty: '5' };
      expect(data).toBeDefined();
    });
  });

  describe('SetValues / SetData', () => {
    it('все поля опциональны — UPDATE меняет лишь перечисленные', () => {
      const data: SetValues<WidgetM> = { note: 'x' };
      expect(data).toEqual({ note: 'x' });
    });

    it('коллбэк типизирован proxy той же модели', () => {
      const data: SetData<WidgetM> = (p) => ({ qty: sql`${p.qty} + 1` });
      expect(typeof data).toBe('function');
    });

    it('колонка вне модели в set() не проходит', () => {
      // @ts-expect-error — поля `qtyy` в модели нет
      const data: SetValues<WidgetM> = { qtyy: 1 };
      expect(data).toBeDefined();
    });
  });

  describe('деградация без кодогена', () => {
    it('~shape = Record<string, unknown> — подсказок нет, но и ошибок нет', () => {
      type UntypedM = { ['~shape']: Record<string, unknown> };

      const values: InsertValuesData<UntypedM> = { anything: 1, atAll: 'x' };
      const set: SetValues<UntypedM> = { whatever: false };

      expect(values.anything).toBe(1);
      expect(set.whatever).toBe(false);
    });
  });

  describe('коллбэк не проходит даже при пустом RequiredOnInsert', () => {
    /** Все поля nullable/defaulted → `RequiredOnInsert` пуст. */
    type AllOptionalM = {
      ['~shape']: { id: number; title: string | undefined };
      ['~defaults']: { id: number };
      ['~rel']: Record<string, unknown>;
      ['~relInfo']: Record<string, unknown>;
    };

    it('объект принимается', () => {
      const data: InsertValuesData<AllOptionalM> = { title: 'x' };
      expect(data.title).toBe('x');
    });

    it('функция отвергается — иначе `Object.entries(fn)` дал бы пустые данные', () => {
      // @ts-expect-error — у values() нет коллбэк-формы
      const data: InsertValuesData<AllOptionalM> = () => ({ title: 'x' });
      expect(data).toBeDefined();
    });
  });

  describe('рантайм: типизированный вход доходит до sqb', () => {
    it('values() раскладывает ключи на алиасы колонок', async () => {
      const adapter = makeMockAdapter();
      adapter.execute.mockResolvedValueOnce([{ id: 1, sku: 'A-1' }]);

      await insert(adapter).values({ sku: 'A-1', qty: 7 }).go();

      const sqb = adapter.execute.mock.calls[0][0] as {
        upsertData: Record<string, unknown>;
      };
      expect(sqb.upsertData).toEqual({ sku: 'A-1', qty: 7 });
    });

    it('фрагмент в values() доезжает до sqb как SqlValue, а не склейкой', async () => {
      const adapter = makeMockAdapter();
      adapter.execute.mockResolvedValueOnce([{ id: 1, sku: 'A-1' }]);

      await insert(adapter)
        .values({ sku: 'A-1', qty: sql`1 + 1` })
        .go();

      const sqb = adapter.execute.mock.calls[0][0] as {
        upsertData: Record<string, unknown>;
      };
      const qty = sqb.upsertData.qty as SqlValue;
      expect(qty).toBeInstanceOf(SqlValue);
      expect(qty.text).toBe('1 + 1');
    });

    it('valuesRaw() пишет колонку, которой нет в модели', async () => {
      const adapter = makeMockAdapter();
      adapter.execute.mockResolvedValueOnce([{ id: 1 }]);

      await insert(adapter).valuesRaw({ sku: 'A-1', legacy_col: 'v' }).go();

      const sqb = adapter.execute.mock.calls[0][0] as {
        upsertData: Record<string, unknown>;
      };
      expect(sqb.upsertData).toEqual({ sku: 'A-1', legacy_col: 'v' });
    });

    it('insertMany().values() раскладывает каждую строку', async () => {
      const adapter = makeMockAdapter();
      adapter.createMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

      await insertMany(adapter)
        .values([{ sku: 'A-1' }, { sku: 'B-2', qty: 3 }])
        .go();

      const [table, rows] = adapter.createMany.mock.calls[0];
      expect(table).toBe('widgets');
      expect(rows).toEqual([{ sku: 'A-1' }, { sku: 'B-2', qty: 3 }]);
    });

    it('update().setRaw() принимает колонку вне модели', () => {
      const adapter = makeMockAdapter();
      update(adapter).setRaw({ legacy_col: 5 });
      const sqb = adapter.toSql.mock.calls;
      expect(sqb).toBeDefined();
    });

    it('values() больше не принимает коллбэк — ссылка на поле в VALUES нерендерится', () => {
      // @ts-expect-error — у values() нет коллбэк-формы: VALUES описывает
      // ещё не существующую строку, а ссылка дала бы 42P01
      insert(makeMockAdapter()).values(() => ({ sku: 'A-1' }));
    });

    it('onConflict().set() коллбэк по-прежнему принимает', () => {
      const adapter = makeMockAdapter();
      const b = insert(adapter)
        .values({ sku: 'A-1' })
        .onConflict((t) => [t.sku])
        .set((p) => ({ qty: sql`${p.qty} + 1` }));

      const sqb = adapter.toSql.mock.calls;
      expect(sqb).toBeDefined();
      expect(typeof b.setRaw).toBe('function');
    });
  });
});
