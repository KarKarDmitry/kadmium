import { Model, f } from '@karkardmitry/kadmium-core';
import { User } from './user';

export class Profile extends Model {
  displayName = f.string;
  user = f.ref.target(User, 'profile').oneToOne();
}