import { readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { createInterface } from 'readline';
import { KadmiumApp } from '../core/kadmium-app';
import {
  computeDiff,
  applyDiff,
  applyDiffTransactional,
  renderSql,
  checkHealth,
} from '@karkardmitry/kadmium-sql-pg';
import { CHECK, CROSS, BULLET, WARN, DOT, box } from './format';

function getDdl(app: KadmiumApp) {
  const adapter = app.modules.sql.get();
  if (!adapter) throw new Error('No SQL adapter configured');
  return adapter.ddl;
}

/** Ask a yes/no question on the terminal. Defaults to "no" when not a TTY. */
async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer: string = await new Promise((resolveAnswer) => {
      rl.question(question, resolveAnswer);
    });
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function exec<T>(app: KadmiumApp, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    const adapter = app.modules.sql.get();
    if (adapter?.end) {
      await adapter.end();
    }
  }
}

export async function dbCheck(app: KadmiumApp): Promise<void> {
  await exec(app, async () => {
    const ddl = getDdl(app);
    const health = await checkHealth(app.appCore.allIrs, ddl);

    console.log('');
    if (health.isHealthy) {
      for (const line of box(`  ${CHECK}  Database schema is up to date`)) {
        console.log(`  ${line}`);
      }
    } else {
      for (const line of box(`  ${WARN}  Database schema needs migration`)) {
        console.log(`  ${line}`);
      }
    }
    console.log('');
    console.log(
      `  Tables: ${health.summary.tablesMatching}/${health.summary.tablesExpected}`,
    );

    if (!health.isHealthy) {
      console.log('');
      console.log('  Issues:');
      for (const issue of health.issues) {
        console.log(`    ${DOT} ${issue}`);
      }
      console.log('');
      console.log('  Run `kadmium db:push` to apply changes.');
    }

    console.log('');
  });
}

export async function dbPush(app: KadmiumApp): Promise<void> {
  await exec(app, async () => {
    const adapter = app.modules.sql.get();
    if (!adapter) throw new Error('No SQL adapter configured');
    const ddl = adapter.ddl;
    const diff = await computeDiff(app.appCore.allIrs, ddl);

    if (!diff.hasChanges) {
      console.log(
        `  ${CHECK}  No changes needed. Database schema is up to date.`,
      );
      return;
    }

    const s = diff.summary;
    console.log('');
    for (const line of box(`  ${BULLET}  Schema changes detected`)) {
      console.log(`  ${line}`);
    }
    console.log('');

    const lines: string[] = [];
    if (s.addedTables > 0)
      lines.push(`    +${s.addedTables} table(s) to create`);
    if (s.addedColumns > 0)
      lines.push(`    +${s.addedColumns} column(s) to add`);
    if (s.droppedColumns > 0)
      lines.push(`    -${s.droppedColumns} column(s) to drop`);
    if (s.alteredColumns > 0)
      lines.push(`    ~${s.alteredColumns} column(s) to alter`);
    if (s.addedIndexes > 0)
      lines.push(`    +${s.addedIndexes} index(es) to add`);
    if (s.droppedIndexes > 0)
      lines.push(`    -${s.droppedIndexes} index(es) to drop`);
    if (s.addedForeignKeys > 0)
      lines.push(`    +${s.addedForeignKeys} foreign key(s) to add`);
    if (s.droppedForeignKeys > 0)
      lines.push(`    -${s.droppedForeignKeys} foreign key(s) to drop`);

    for (const line of lines) {
      console.log(`  ${line}`);
    }

    console.log('');
    console.log(`  Applying ${diff.operations.length} change(s)...`);

    let applied: string[];
    try {
      applied = await applyDiffTransactional(diff, adapter);
    } catch (err) {
      console.log('');
      for (const line of box(`  ${WARN}  Transactional apply failed`)) {
        console.log(`  ${line}`);
      }
      console.log('');
      console.log(`  ${(err as Error).message}`);
      console.log('');
      const retry = await promptYesNo(
        `  ${WARN}  Retry without transaction? [y/N]: `,
      );
      if (!retry) throw err;
      applied = await applyDiff(diff, ddl);
    }

    for (const desc of applied) {
      console.log(`    ${CHECK} ${desc}`);
    }

    console.log('');
    console.log(`  ${CHECK} Done.`);
    console.log('');
  });
}

export async function dbClear(app: KadmiumApp, force: boolean): Promise<void> {
  if (!force) {
    console.log('');
    console.log(
      `  ${WARN}  WARNING: This will DELETE ALL TABLES from the database.`,
    );
    console.log('  This includes all data and cannot be undone.');
    console.log('');
    console.log('  To proceed, run: kadmium db:clear --force');
    console.log('');
    return;
  }

  await exec(app, async () => {
    const ddl = getDdl(app);
    const tables = await ddl.inspectTables();

    if (tables.length === 0) {
      console.log(`  ${CHECK}  Database is already empty.`);
      return;
    }

    console.log('');
    console.log(`  Dropping ${tables.length} table(s)...`);
    console.log('');

    for (const table of tables) {
      await ddl.dropTable(table.name);
      console.log(`    ${CROSS}  DROP TABLE ${table.name}`);
    }

    console.log('');
    console.log(`  ${CHECK}  Database cleared.`);
    console.log('');
  });
}

function nextSqlFile(dir: string): string {
  if (!existsSync(dir)) return `1-${Date.now()}.sql`;
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  let max = 0;
  for (const f of files) {
    const num = parseInt(f.split('-')[0], 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return `${max + 1}-${Date.now()}.sql`;
}

export async function dbSql(
  app: KadmiumApp,
  outputPath?: string,
): Promise<void> {
  await exec(app, async () => {
    const ddl = getDdl(app);
    const diff = await computeDiff(app.appCore.allIrs, ddl);

    let fullPath: string;
    if (!outputPath) {
      const dir = '.sql';
      fullPath = resolve(`${dir}/${nextSqlFile(dir)}`);
    } else if (outputPath.endsWith('.sql')) {
      fullPath = resolve(outputPath);
    } else {
      fullPath = resolve(`${outputPath}/${nextSqlFile(outputPath)}`);
    }

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, renderSql(diff), 'utf-8');

    console.log('');
    for (const line of box(`  ${BULLET}  SQL migration written`)) {
      console.log(`  ${line}`);
    }
    console.log('');
    console.log(`  ${CHECK}  ${fullPath}`);
    console.log('');
  });
}
