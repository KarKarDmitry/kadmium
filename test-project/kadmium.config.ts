import { defineConfig } from '@karkardmitry/kadmium-core';
import { PgAdapter, pgDialect } from '@karkardmitry/kadmium-sql-pg';

export default defineConfig({
  modelSources: ['src/models/**/*.ts'],
  modelsPath: '../src/models',
  modules: {
    // Диалект обязателен рядом с адаптером: движок диффа спрашивает его про
    // имена типов и `DEFAULT`. Ставится один раз, а не на каждый адаптер.
    dialect: pgDialect,
    sql: new PgAdapter({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'kadmium_test',
      login: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    }),
  },
});
