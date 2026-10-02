import { Model, f } from '@karkardmitry/kadmium-core';
import { User } from './user';

/**
 * Модель с нестандартным первичным ключом: свойство называется `uid`
 * (а не `id`), а колонка в БД переименована через `.alias()`.
 *
 * Дефолтный `id` из `Model` обязан вытесниться, иначе в IR попадают два
 * `isPrimary` и `CREATE TABLE` падает в PostgreSQL с 42710. Связь с `User`
 * проверяет, что JOIN собирается по колонке PK, а не по литералу `'id'`.
 */
export class LoginSession extends Model {
  uid = f.pk.uuid.alias('session_uid');
  token = f.string;
  user = f.ref.target(User, 'loginSessions').onDelete('cascade');
}