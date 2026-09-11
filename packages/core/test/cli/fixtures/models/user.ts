import { Model, f } from '../../../../src';

export class User extends Model {
  id = f.pk;
  name = f.string;
  email = f.string.unique();
}
