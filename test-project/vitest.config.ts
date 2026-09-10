import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    setupFiles: ['ts-node/register'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
    reporters: ['verbose'],
  },
});