#!/usr/bin/env node
/**
 * Kadmium CLI entry point.
 * В development использует ts-node для компиляции TypeScript.
 * В production (npm publish) заменяется на dist/bin/kadmium.js.
 */
(function () {
  // Пытаемся найти ts-node
  try {
    require.resolve('ts-node');
  } catch {
    console.error(
      'kadmium CLI requires ts-node to be installed.\n' +
        'Install it: npm install --save-dev ts-node',
    );
    process.exit(1);
  }

  require('ts-node').register({
    transpileOnly: true,
    // TODO(cli.md): remove once PR-B lands — packages publish built dist
    // (main/types/bin -> dist). Until then ts-node must transpile TS from
    // both the package tree and the user project under one cwd tsconfig.
    ignoreDiagnostics: [5011],
  });
  require('../src/bin/kadmium');
})();
