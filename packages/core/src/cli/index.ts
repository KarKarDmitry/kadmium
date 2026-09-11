import { resolve } from 'path';
import { init } from './init';
import { generateCommand } from './generate';
import { checkCommand } from './check';
import { KadmiumApp } from '../core/kadmium-app';
import { dbCheck, dbPush, dbSql, dbClear } from './db';
import { loadEnv } from './env';

async function withApp(
  configPath: string,
  fn: (app: KadmiumApp) => Promise<void>,
): Promise<void> {
  loadEnv(configPath);
  const app = new KadmiumApp();
  await app.init(configPath);
  if (!app.modules.sql.get()) {
    throw new Error(
      'No SQL adapter configured in kadmium.config.ts (modules.sql)',
    );
  }
  await fn(app);
}

export async function run(args: string[]): Promise<void> {
  const command = args[0];

  // Extract flags (--xxx) and positional args
  const flags = args.filter((a) => a.startsWith('--'));
  const positionals = args.filter((a) => !a.startsWith('--'));
  const projectDir = positionals[1] ?? '.';

  switch (command) {
    case 'init': {
      init(resolve(projectDir));
      break;
    }

    case 'generate': {
      generateCommand(resolve(projectDir)).catch((err) => {
        console.error('❌ Generate failed:', err.message);
        process.exit(1);
      });
      break;
    }

    case 'check': {
      checkCommand(resolve(projectDir)).catch((err) => {
        console.error('❌ Check failed:', err.message);
        process.exit(1);
      });
      break;
    }

    case 'db:check': {
      await withApp(projectDir, dbCheck);
      break;
    }

    case 'db:push': {
      await withApp(projectDir, dbPush);
      break;
    }

    case 'db:sql': {
      const outputPath = positionals[2];
      await withApp(projectDir, (app) => dbSql(app, outputPath));
      break;
    }

    case 'db:clear': {
      const force = flags.includes('--force');
      await withApp(projectDir, (app) => dbClear(app, force));
      break;
    }

    case '--help':
    case '-h':
    case undefined: {
      console.log(`
Usage: npx kadmium <command> [options]

Commands:
  init [dir]              Initialize kadmium project structure
  generate [dir]          Generate augment types from models
  check [dir]             Verify generated augment types are up to date
  db:check [dir]          Check database schema vs models
  db:push [dir]           Push schema changes to database
  db:clear [dir]          Drop all tables (use --force to proceed)
  db:sql [dir] [output]   Generate SQL migration file

Examples:
  npx kadmium init
  npx kadmium generate
  npx kadmium db:check
  npx kadmium db:push
  npx kadmium db:clear --force
  npx kadmium db:sql .sql/migration.sql
`);
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.error('Run `npx kadmium --help` for usage.');
      process.exit(1);
    }
  }
}
