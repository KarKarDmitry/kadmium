import { existsSync } from 'fs';
import { resolve } from 'path';
import type { KadmiumConfig } from './config';

/**
 * ConfigLoader — поиск и загрузка kadmium.config.{ts,js}.
 */
export class ConfigLoader {
  /**
   * Найти и загрузить конфиг в указанной директории.
   * Проверяет: kadmium.config.ts, kadmium.config.js, src/../
   */
  async load(projectDir: string): Promise<KadmiumConfig | null> {
    const candidates = [
      resolve(projectDir, 'kadmium.config.ts'),
      resolve(projectDir, 'kadmium.config.js'),
      resolve(projectDir, 'src/kadmium.config.ts'),
      resolve(projectDir, 'src/kadmium.config.js'),
    ];

    for (const file of candidates) {
      if (existsSync(file)) {
        const mod = await import(file);
        return mod.default ?? mod.config ?? {};
      }
    }
    return null;
  }
}
