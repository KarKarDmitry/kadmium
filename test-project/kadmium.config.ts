import { defineConfig } from '@karkardmitry/kadmium-core';
import { PgAdapter } from '@karkardmitry/kadmium-sql-pg';

export default defineConfig({
  modelSources: ['src/models/**/*.ts'],
  modelsPath: '../src/models',
  modules: {
    sql: new PgAdapter({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'kadmium_test',
      login: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    }),
  },
});
