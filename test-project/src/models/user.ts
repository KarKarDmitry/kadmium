import { Model, f } from '@karkardmitry/kadmium-core';

export class User extends Model {
  name = f.string;
  email = f.string.unique();
  age = f.number;
  active = f.bool;
  registeredAt = f.datetime;
}
