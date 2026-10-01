import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Без `setupFiles: ['ts-node/register']`: харнес собирает AppCore из уже
    // импортированных классов моделей, а конфиг целиком грузится одним
    // файлом-тестом `index.test.ts`, который регистрирует ts-node сам.
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
    reporters: ['verbose'],
  },
});