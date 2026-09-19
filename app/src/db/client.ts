import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { loadEnv } from '../config/env.js';
import * as schema from './schema.js';

/**
 * Conservative connection pool (§109): shared hosting budget, default max 5.
 * Single module-level pool; API/worker/scheduler each create their own process pool.
 */
let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (pool) return pool;
  const env = loadEnv();
  // mysql2 accepts nodejs-style URL or connection string
  pool = mysql.createPool({
    uri: env.DATABASE_URL,
    connectionLimit: env.DB_POOL_MAX,
    waitForConnections: true,
    queueLimit: 20,
    timezone: 'Z',
    charset: 'utf8mb4_unicode_ci',
    enableKeepAlive: true,
  });
  return pool;
}

export type Db = ReturnType<typeof drizzle>;

export function getDb(): Db {
  return drizzle(getPool(), { schema, mode: 'default' });
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export { schema };
