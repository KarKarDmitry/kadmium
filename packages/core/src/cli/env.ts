import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Load `projectDir/.env` into process.env without overriding variables that
 * are already set. Runs before kadmium.config.ts is imported so the config
 * can read connection settings from the environment.
 */
export function loadEnv(projectDir: string): void {
  const path = resolve(projectDir, '.env');
  if (!existsSync(path)) return;
  process.loadEnvFile(path);
}
