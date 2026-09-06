/**
 * Микро-бенчмарк IR-кеша.
 *
 * Сравнивает стоимость компиляции модели на каждый запрос (старое поведение
 * `orm.single()`/`query()`) с чтением уже скомпилированного IR из реестра
 * (новое поведение). Это CPU-затраты; в I/O-bound интеграционных тестах они
 * не видны на wall-time, но в серверном цикле на тысячах запросов — заметны.
 *
 * Запуск: npm run bench
 */
import { AppCore } from '@karkardmitry/kadmium-core';
import { compileModel } from '@karkardmitry/kadmium-core';
import { User, Post, Comment } from '../src/models';

const N = 10_000;

function bench(label: string, fn: () => void): string {
  const t = process.hrtime.bigint();
  for (let i = 0; i < N; i++) fn();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  return `${label.padEnd(34)} ${ms.toFixed(1).padStart(7)}ms total / ${((ms / N) * 1e3).toFixed(2).padStart(6)}µs per call`;
}

// Один раз компилируем при регистрации — как делает AppCore.loadConfig()
const app = new AppCore();
app.register([User, Post, Comment]);

const compileTime = bench('compileModel (old: per query)', () =>
  compileModel(new User() as never),
);
const lookupTime = bench('app.ir lookup (new: registry)', () => app.ir('User'));

const parse = (s: string): number =>
  Number(s.split('total')[0].trim().split(' ').at(-1)?.replace('ms', ''));

console.log(`\nIR cache micro-benchmark (N=${N}):`);
console.log(`  ${compileTime}`);
console.log(`  ${lookupTime}`);
console.log(
  `  speedup: ${(parse(compileTime) / Math.max(parse(lookupTime), 0.001)).toFixed(0)}x`,
);
