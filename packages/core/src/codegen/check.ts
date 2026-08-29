/**
 * Пример entry point для npm run check.
 *
 * Скопируйте этот файл в свой проект и замените путь
 * к вашим моделям.
 *
 * ```ts
 * // scripts/check-types.ts
 * import { checkSync } from 'kadmium/src/codegen';
 * import './src/models'; // ваши модели
 *
 * const ok = checkSync('types/models.d.ts');
 * if (!ok) process.exit(1);
 * ```
 *
 * Затем в package.json:
 * ```json
 * {
 *   "scripts": {
 *     "check": "ts-node scripts/check-types.ts"
 *   }
 * }
 * ```
 */

import { checkSync } from './index';

// ЗАМЕНИТЕ на импорт ваших моделей:
// import './src/models';

const ok = checkSync('types/models.d.ts');
if (!ok) process.exit(1);
