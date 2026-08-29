import { _DBOptions } from '../types/_base';
import type {
  PrimaryField,
  BigIntPrimaryField,
  StringPrimaryField,
  UUIDPrimaryField,
  StringPrimaryField_Spec,
} from '../types/primary';
import { AbstractFieldBuilder } from './_base';

export class BasePrimaryField implements AbstractFieldBuilder {
  private db: _DBOptions = {
    index: true,
    unique: true,
    nullable: false,
  };

  $build(): PrimaryField {
    return {
      _meta: { _: 'field', _type: 'primary' },
      type: '_',
      db: this.db,
      tsType: 'number',
    };
  }
}

export class BigIntPrimaryFieldBuilder extends BasePrimaryField {
  private increment: boolean = true;

  $build(): BigIntPrimaryField {
    const base = super.$build();
    return {
      ...base,
      type: 'bigint',
      increment: this.increment,
      tsType: 'number',
    };
  }
}

export class StringPrimaryFieldBuilder extends BasePrimaryField {
  private spec: StringPrimaryField_Spec = 'auto';

  $build(): StringPrimaryField {
    const base = super.$build();
    return { ...base, type: 'string', spec: this.spec, tsType: 'string' };
  }
}

export class UUIDPrimaryFieldBuilder extends BasePrimaryField {
  $build(): UUIDPrimaryField {
    const base = super.$build();
    return {
      ...base,
      type: 'uuid',
      db: { ...base.db, db_type: 'uuid' },
      tsType: 'string',
    };
  }
}

export class PrimaryFieldBuilder implements AbstractFieldBuilder {
  get bigint() {
    return new BigIntPrimaryFieldBuilder();
  }
  get string() {
    return new StringPrimaryFieldBuilder();
  }
  get uuid() {
    return new UUIDPrimaryFieldBuilder();
  }

  $build() {
    return new BigIntPrimaryFieldBuilder().$build();
  }
}
