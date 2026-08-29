import { Model, f } from '@karkardmitry/kadmium-core';
import { User } from './user';

export class Post extends Model {
  title = f.string;
  content = f.string;
  published = f.bool.notNull().default(true);
  views = f.number.notNull().default(0);
  author = f.ref.target(User, 'posts');
}
