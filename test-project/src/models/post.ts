import { Model, f } from '@karkardmitry/kadmium-core';
import { User } from './user';

export class Post extends Model {
  title = f.string;
  content = f.string;
  published = f.bool.notNull();
  views = f.number.notNull();
  author = f.ref.target(User, 'posts');
}
