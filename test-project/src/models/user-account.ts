import { Model, f } from '@karkardmitry/kadmium-core';
import { User } from './user';

export class UserAccount extends Model {
  id = f.pk.uuid;
  displayLabel = f.string.alias('display_label');
  createdBy = f.ref.target(User, 'accounts');
}