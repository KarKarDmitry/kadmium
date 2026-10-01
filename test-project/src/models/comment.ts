import { Model, f } from '@karkardmitry/kadmium-core';
import { Post } from './post';
import { User } from './user';

export class Comment extends Model {
  text = f.string.default('');
  flagged = f.bool.alias('is_flagged');
  // FK-колонка здесь, поэтому действия задаются здесь же: удаление поста уносит
  // комментарии, а удаление автора обнуляет ссылку, потому что колонка
  // nullable (f.ref по умолчанию).
  post = f.ref.target(Post, 'comments').onDelete('cascade');
  user = f.ref.target(User, 'comments').onDelete('set null');
}
