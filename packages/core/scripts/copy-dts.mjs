import { cpSync, existsSync, readdirSync } from 'fs';
import { join, relative, dirname } from 'path';

const srcRoot = join(import.meta.dirname, '..', 'src');
const distRoot = join(import.meta.dirname, '..', 'dist', 'src');

function copyDts(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      copyDts(abs);
    } else if (entry.name.endsWith('.d.ts')) {
      const rel = relative(srcRoot, abs);
      const dest = join(distRoot, rel);
      cpSync(abs, dest, { recursive: true });
    }
  }
}

if (existsSync(srcRoot)) copyDts(srcRoot);