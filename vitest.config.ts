import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'packages/core/test/**/*.test.ts',
      'packages/sql-pg/test/**/*.test.ts',
    ],
  },
});
