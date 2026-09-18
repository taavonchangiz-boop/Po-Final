/**
 * MySQL connection pool + Drizzle client (pool ≤ 5 per ADR-003),
 * schema re-export and transaction helper.
 */
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import * as schema from './schema.js';

export const pool: mysql.Pool = mysql.createPool({
  uri: env.DATABASE_URL,
  connectionLimit: 5,
  timezone: 'Z',
  charset: 'utf8mb4',
});

export const db = drizzle(pool, { schema, mode: 'default' });

export { schema };

export type Database = typeof db;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Any drizzle executor that can run inserts/updates (root db or a transaction). */
export type DbExecutor = Database | Tx;

/** Run `fn` inside a transaction; rolls back on throw, commits otherwise. */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}
