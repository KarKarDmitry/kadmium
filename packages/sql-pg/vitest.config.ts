import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@karkardmitry/kadmium-sql-types': fileURLToPath(
        new URL('../sql-types/src/index.ts', import.meta.url),
      ),
      '@karkardmitry/kadmium-sql-pg': fileURLToPath(
        new URL('../sql-pg/src/index.ts', import.meta.url),
      ),
      '@karkardmitry/kadmium-core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});