/**
 * Пример скрипта генерации типов для вашего проекта.
 *
 * Скопируйте этот файл в свой проект как scripts/generate.ts
 * и замените путь к вашим моделям.
 *
 * ```ts
 * // scripts/generate.ts
 * import { generateToFile } from 'kadmium/src/codegen';
 * import './src/models'; // ваши модели (должны вызывать Model.register())
 *
 * generateToFile('types/models.d.ts');
 * ```
 *
 * Затем в package.json добавьте:
 * ```json
 * {
 *   "scripts": {
 *     "generate": "ts-node scripts/generate.ts",
 *     "check": "ts-node scripts/check-types.ts"
 *   }
 * }
 * ```
 */

export {};
