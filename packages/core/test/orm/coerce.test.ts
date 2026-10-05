import { describe, it, expect } from 'vitest';
import {
  applyCoercion,
  buildCoercionNode,
  buildMultiCoercionNode,
} from '../../src/orm/builders/coerce';
import { aggregates } from '../../src/orm/field-builders/aggregates';
import { windowFunctions } from '../../src/orm/field-builders/window-functions';
import { SelectableField } from '../../src/orm/ast/selectable';
import type { FieldIR, ModelIR } from '../../src/ir/index';
import type {
  IncludedRelation,
  SelectItem,
} from '@karkardmitry/kadmium-sql-types';

function field(
  type: FieldIR['type'],
  tsType: FieldIR['tsType'],
  extra: Partial<FieldIR> = {},
): FieldIR {
  return {
    type,
    tsType,
    alias: '',
    nullable: false,
    unique: false,
    index: false,
    ...extra,
  };
}

/** Модель со всеми числовыми категориями разом. */
function measureIR(): ModelIR {
  return {
    name: 'Measure',
    collection: 'measures',
    fields: {
      id: field('bigint', 'number', { isPrimary: true, alias: 'id' }),
      count4: field('int', 'number', { alias: 'count4' }),
      big: field('bigint', 'number', { alias: 'big' }),
      price: field('decimal', 'number', { alias: 'price' }),
      ratio: field('float', 'number', { alias: 'ratio' }),
      title: field('string', 'string', { alias: 'title' }),
      uid: field('uuid', 'string', { alias: 'uid' }),
      owner: field('ref', 'number', { alias: 'owner', ref: 'Owner' }),
    },
  };
}

function ownerIR(): ModelIR {
  return {
    name: 'Owner',
    collection: 'owners',
    fields: { id: field('bigint', 'number', { isPrimary: true, alias: 'id' }) },
  };
}

const LOOKUP = (name: string): ModelIR | undefined =>
  name === 'Measure' ? measureIR() : name === 'Owner' ? ownerIR() : undefined;

/** Плоский список колонок плана — удобно для assert'ов в одну строку. */
function guards(
  node: ReturnType<typeof buildCoercionNode>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of node?.columns ?? []) out[c.prop] = c.guard;
  return out;
}

/** Список `prop → guard` из select-проекции. */
function projected(
  ir: ModelIR,
  selects: SelectItem[],
  lookup = LOOKUP,
): Record<string, string> {
  return guards(buildCoercionNode(ir, selects, [], lookup));
}

describe('buildCoercionNode — RETURNING * (selects === null)', () => {
  it('берёт сторож из типа поля', () => {
    expect(guards(buildCoercionNode(measureIR(), null, [], LOOKUP))).toEqual({
      id: 'integer',
      count4: 'integer',
      big: 'integer',
      price: 'numeric',
      ratio: 'float',
      owner: 'integer',
    });
  });

  it('пропускает не-числовые поля', () => {
    const g = guards(buildCoercionNode(measureIR(), null, [], LOOKUP));
    expect(g).not.toHaveProperty('title');
    expect(g).not.toHaveProperty('uid');
  });

  it('берёт сторож FK-колонки у PK цели', () => {
    const ir = measureIR();
    ir.fields.owner = field('ref', 'number', {
      alias: 'owner',
      ref: 'Owner',
    });
    // PK цели — bigint, значит и FK сторожится как целое.
    expect(guards(buildCoercionNode(ir, null, [], LOOKUP)).owner).toBe(
      'integer',
    );

    ir.fields.owner = field('ref', 'number', {
      alias: 'owner',
      ref: 'UuidOwner',
    });
    expect(
      guards(
        buildCoercionNode(ir, null, [], (n) =>
          n === 'UuidOwner'
            ? {
                name: 'UuidOwner',
                collection: 'uuid_owners',
                fields: {
                  id: field('uuid', 'string', { isPrimary: true, alias: 'id' }),
                },
              }
            : LOOKUP(n),
        ),
      ).owner,
    ).toBeUndefined();
  });

  it('пропускает обратную связь — у неё нет колонки', () => {
    const ir = measureIR();
    ir.fields.posts = field('ref', 'number', {
      alias: 'posts',
      ref: 'Post',
      sourceModel: 'Post',
    });
    expect(guards(buildCoercionNode(ir, null, [], LOOKUP))).not.toHaveProperty(
      'posts',
    );
  });

  it('ключ колонки — alias, а не проп', () => {
    const ir = measureIR();
    ir.fields.count4 = field('int', 'number', { alias: 'views_count' });
    const g = guards(buildCoercionNode(ir, null, [], LOOKUP));
    expect(g).toHaveProperty('views_count');
    expect(g).not.toHaveProperty('count4');
  });

  it('возвращает undefined, когда приводить нечего', () => {
    const ir: ModelIR = {
      name: 'Only',
      collection: 'only',
      fields: { title: field('string', 'string', { alias: 'title' }) },
    };
    expect(buildCoercionNode(ir, null, [], LOOKUP)).toBeUndefined();
  });
});

describe('buildCoercionNode — проекция', () => {
  const ir = measureIR();
  // (tableAlias, fieldName, alias, aggregate, column)
  const sel = (name: string, alias?: string) =>
    new SelectableField('m', name, alias, undefined, `${name}_col`);

  it('ключ результата — alias селекта, иначе fieldName', () => {
    expect(projected(ir, [sel('count4'), sel('price', 'price_alias')])).toEqual(
      {
        count4: 'integer',
        price_alias: 'numeric',
      },
    );
  });

  it('берёт сторож у модели своего алиаса, а не у корневой', () => {
    // У m.big — bigint, у x.big — decimal: одно имя, разный сторож.
    const node = buildCoercionNode(
      ir,
      [new SelectableField('x', 'big')],
      [],
      (n) =>
        n === 'x'
          ? {
              name: 'x',
              collection: 'xs',
              fields: { big: field('decimal', 'number', { alias: 'big' }) },
            }
          : LOOKUP(n),
    );
    expect(node?.columns).toEqual([
      {
        prop: 'big',
        tsType: 'number',
        guard: 'numeric',
        source: 'Measure.big',
      },
    ]);

    // Алиас неизвестен lookup'у — падаем на IR корневой модели.
    expect(
      buildCoercionNode(
        ir,
        [new SelectableField('x', 'big')],
        [],
        () => undefined,
      )?.columns,
    ).toEqual([
      {
        prop: 'big',
        tsType: 'number',
        guard: 'integer',
        source: 'Measure.big',
      },
    ]);
  });

  it('пропускает sql-фрагменты — их тип живёт в фантоме', () => {
    const sqlItem = {
      kind: 'sql-item' as const,
      alias: 'raw',
      text: '1',
      values: [],
      slotOrder: [],
    } as unknown as SelectItem;
    expect(projected(ir, [sqlItem])).toEqual({});
  });
});

describe('buildCoercionNode — агрегаты и окна', () => {
  const ir = measureIR();
  const f = (name: string) => new SelectableField('m', name, name);

  it('count и rank-семейство всегда int8', () => {
    expect(projected(ir, [aggregates.count('*').as('c')])).toEqual({
      c: 'integer',
    });
    expect(projected(ir, [windowFunctions.rowNumber().as('rn')])).toEqual({
      rn: 'integer',
    });
    expect(projected(ir, [windowFunctions.rank().as('r')])).toEqual({
      r: 'integer',
    });
  });

  it('sum(int4) → int8, но sum(int8) → numeric', () => {
    expect(projected(ir, [aggregates.sum(f('count4')).as('s')])).toEqual({
      s: 'integer',
    });
    expect(projected(ir, [aggregates.sum(f('big')).as('s')])).toEqual({
      s: 'numeric',
    });
    expect(projected(ir, [aggregates.sum(f('price')).as('s')])).toEqual({
      s: 'numeric',
    });
  });

  it('avg всегда numeric — PG делит даже int4', () => {
    expect(projected(ir, [aggregates.avg(f('count4')).as('a')])).toEqual({
      a: 'numeric',
    });
    expect(projected(ir, [aggregates.avg(f('big')).as('a')])).toEqual({
      a: 'numeric',
    });
    expect(projected(ir, [aggregates.avg(f('ratio')).as('a')])).toEqual({
      a: 'float',
    });
  });

  it('min/max следуют за типом поля', () => {
    expect(projected(ir, [aggregates.max(f('ratio')).as('m')])).toEqual({
      m: 'float',
    });
    expect(projected(ir, [aggregates.min(f('title')).as('m')])).toEqual({});
  });

  it('скользящее avg в окне — numeric, а не integer', () => {
    const w = aggregates.avg(f('count4')).over().as('ma');
    expect(projected(ir, [w])).toEqual({ ma: 'numeric' });
  });
});

describe('buildCoercionNode — include', () => {
  function rel(
    parentField: string,
    relationType: IncludedRelation['relationType'],
    targetIr: { name: string },
    selects: SelectItem[] | null,
    includes: IncludedRelation[] = [],
  ): IncludedRelation {
    return {
      parentAlias: 'm',
      propertyName: parentField,
      relationType,
      parentField,
      childField: 'id',
      internalSqb: { selects, includes } as never,
      targetIr: targetIr as never,
    };
  }

  it('строит узел по проекции включения', () => {
    const node = buildCoercionNode(
      measureIR(),
      null,
      [rel('owner', 'many-to-one', { name: 'Owner' }, null)],
      LOOKUP,
    );
    expect(node?.includes?.owner).toEqual({
      columns: [
        { prop: 'id', tsType: 'number', guard: 'integer', source: 'Owner.id' },
      ],
      many: false,
    });
  });

  it('помечает one-to-many как many', () => {
    const node = buildCoercionNode(
      measureIR(),
      null,
      [rel('owner', 'one-to-many', { name: 'Owner' }, null)],
      LOOKUP,
    );
    expect(node?.includes?.owner.many).toBe(true);
  });

  it('рекурсивно спускается во вложенные include', () => {
    const node = buildCoercionNode(
      measureIR(),
      null,
      [
        rel('owner', 'many-to-one', { name: 'Owner' }, null, [
          rel('inner', 'many-to-one', { name: 'Owner' }, null),
        ]),
      ],
      LOOKUP,
    );
    expect(node?.includes?.owner.includes?.inner).toBeDefined();
  });

  it('пропускает включение, где приводить нечего', () => {
    const node = buildCoercionNode(
      measureIR(),
      null,
      [
        rel('owner', 'many-to-one', { name: 'Owner' }, [
          new SelectableField('o', 'title', 'title'),
        ]),
      ],
      LOOKUP,
    );
    // Корень приводится (RETURNING * у Measure), а включение — нет.
    expect(node?.includes).toBeUndefined();
  });
});

describe('buildMultiCoercionNode', () => {
  it('вешает узлы по алиасам и фильтрует чужие селекты', () => {
    const irs = new Map([
      ['m', measureIR()],
      ['o', ownerIR()],
    ]);
    const node = buildMultiCoercionNode(
      irs,
      [
        new SelectableField('m', 'price', 'price'),
        Object.assign(new SelectableField('o', 'id', 'id'), {
          tableAlias: 'o',
        }),
      ],
      [],
      LOOKUP,
    );
    expect(Object.keys(node?.includes ?? {})).toEqual(['m', 'o']);
    expect(node?.columns).toEqual([]);
  });

  it('выбирает только селекты своего алиаса', () => {
    const irs = new Map([['m', measureIR()]]);
    const node = buildMultiCoercionNode(
      irs,
      [
        Object.assign(new SelectableField('m', 'title', 'title'), {
          tableAlias: 'm',
        }),
      ],
      [],
      LOOKUP,
    );
    expect(node).toBeUndefined();
  });
});

describe('applyCoercion', () => {
  const node = buildCoercionNode(measureIR(), null, [], LOOKUP)!;

  it('приводит int8/numeric строки в числа', () => {
    const rows = [{ id: '42', price: '10.500', ratio: '1.5', title: 'x' }];
    expect(applyCoercion(node, rows)[0]).toEqual({
      id: 42,
      price: 10.5,
      ratio: 1.5,
      title: 'x',
    });
  });

  it('бросает за пределом Number.MAX_SAFE_INTEGER', () => {
    expect(() => applyCoercion(node, [{ id: '9007199254740993' }])).toThrow(
      /Cannot read Measure.id as a number/,
    );
    expect(() =>
      applyCoercion(node, [{ id: '9007199254740991' }]),
    ).not.toThrow();
  });

  it('бросает на потере значащих цифр numeric', () => {
    expect(() =>
      applyCoercion(node, [{ price: '1234567890123456.7' }]),
    ).toThrow(/more than 15 significant digits/);
    expect(() =>
      applyCoercion(node, [{ price: '0.0000000000000000001' }]),
    ).not.toThrow();
  });

  it('не бросает на float — неточность заложена в тип', () => {
    expect(() =>
      applyCoercion(node, [{ ratio: '1.234567890123456789' }]),
    ).not.toThrow();
  });

  it('идемпотентен: число остаётся числом', () => {
    const rows = [{ id: 42, price: 10.5 }];
    expect(applyCoercion(node, rows)[0]).toEqual({ id: 42, price: 10.5 });
  });

  it('пропускает отсутствующую колонку', () => {
    expect(applyCoercion(node, [{}])[0]).toEqual({});
  });

  it('меняет строки на месте и возвращает те же', () => {
    const rows = [{ id: '7' }];
    expect(applyCoercion(node, rows)).toBe(rows);
  });

  it('приводит вложенные объекты и массивы', () => {
    const plan = buildCoercionNode(
      measureIR(),
      null,
      [
        {
          parentAlias: 'm',
          propertyName: 'owner',
          relationType: 'one-to-many',
          parentField: 'owner',
          childField: 'id',
          internalSqb: {
            selects: null,
            includes: [],
          } as never,
          targetIr: { name: 'Owner' } as never,
        },
      ],
      LOOKUP,
    );
    const rows = [{ owner: { id: '5' } }];
    expect(applyCoercion(plan, rows)[0]).toEqual({ owner: { id: 5 } });

    const many = buildCoercionNode(
      measureIR(),
      null,
      [
        {
          parentAlias: 'm',
          propertyName: 'owner',
          relationType: 'one-to-many',
          parentField: 'owner',
          childField: 'id',
          internalSqb: { selects: null, includes: [] } as never,
          targetIr: { name: 'Owner' } as never,
        },
      ],
      LOOKUP,
    );
    const list = [{ owner: [{ id: '5' }, { id: '6' }] }];
    expect(applyCoercion(many, list)[0]).toEqual({
      owner: [{ id: 5 }, { id: 6 }],
    });
  });

  it('без плана строки не трогает', () => {
    const rows = [{ id: '9007199254740993' }];
    expect(applyCoercion(undefined, rows)[0]).toEqual({
      id: '9007199254740993',
    });
  });
});
