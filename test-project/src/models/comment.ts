import { Model, f } from '@karkardmitry/kadmium-core';
import { Post } from './post';
import { User } from './user';

export class Comment extends Model {
  text = f.string.default('');
  flagged = f.bool.alias('is_flagged');
  post = f.ref.target(Post, 'comments');
  user = f.ref.target(User, 'comments');
}
