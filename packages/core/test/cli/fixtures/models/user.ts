import { Model, f } from '@karkardmitry/kadmium-core';

export class User extends Model {
  id = f.pk;
  name = f.string;
  email = f.string.unique();
}
