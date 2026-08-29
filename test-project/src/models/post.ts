import { Model, f } from '@karkardmitry/kadmium-core';
import { User } from './user';

export class Post extends Model {
  title = f.string;
  content = f.string.alias('body').index();
  author = f.ref.target(User, 'posts');
  asas = f.number.notNull();
}

export class Post_posts extends Post {
  title2 = f.string;
}
