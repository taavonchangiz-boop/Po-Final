import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: '../database/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://root:root@localhost:3306/postyar',
  },
  verbose: true,
  strict: true,
});
