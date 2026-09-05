// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier'; // Импортируем пакет

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier, // Добавляем сюда, чтобы отключить конфликтующие правила ESLint[reference:7]
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // ORM слой использует any для phantom generics, overload паттернов и Proxy кастов
  // {
  //   files: ['packages/core/src/orm/**/*.ts'],
  //   rules: {
  //     '@typescript-eslint/no-explicit-any': 'off',
  //     '@typescript-eslint/no-unsafe-return': 'off',
  //     '@typescript-eslint/no-unsafe-argument': 'off',
  //     '@typescript-eslint/no-unsafe-member-access': 'off',
  //     '@typescript-eslint/no-unsafe-call': 'off',
  //     '@typescript-eslint/no-unused-vars': 'off',
  //     '@typescript-eslint/no-empty-object-type': 'off',
  //   },
  // },
  {
    files: ['test-project/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    ignores: [
      'dist/**',
      '!**/node_modules/**',
      'kadmium-test/**',
      'help_source/**',
      'test-project/node_modules/**',
    ],
  },
);
