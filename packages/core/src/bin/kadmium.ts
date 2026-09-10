#!/usr/bin/env node
/**
 * Kadmium CLI entry point.
 * Компилирует только пользовательский TypeScript (config/models/scripts)
 * через ts-node с tsconfig текущей директории. Пакеты загружаются из dist.
 */

import { register } from 'ts-node';

register({ transpileOnly: true });

import { run } from '../cli/index';

run(process.argv.slice(2)).catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
