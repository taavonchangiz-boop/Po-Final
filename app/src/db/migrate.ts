/**
 * Migration runner: applies ../database/migrations/*.sql (drizzle naming,
 * ordered by filename) inside a transaction each, records applied files in
 * `__postyar_migrations`, skips applied ones and refuses on drift.
 *
 * Usage: bun run db:migrate  (tsx src/db/migrate.ts)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const MIGRATIONS_TABLE = '__postyar_migrations';
// app/src/db -> app -> postyar-production-final/database/migrations
const MIGRATIONS_DIR = new URL('../../../database/migrations/', import.meta.url);

const BREAKPOINT = '--> statement-breakpoint';

async function ensureTable(conn: mysql.Connection): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function appliedFiles(conn: mysql.Connection): Promise<Set<string>> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT filename FROM ${MIGRATIONS_TABLE}`);
  return new Set(rows.map((r) => String(r['filename'])));
}

function listSqlFiles(): string[] {
  const dir = MIGRATIONS_DIR.pathname;
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    throw new Error(`Migrations directory not found or unreadable: ${dir}`);
  }
}

async function applyMigration(conn: mysql.Connection, filename: string): Promise<void> {
  const filePath = join(MIGRATIONS_DIR.pathname, filename);
  const content = readFileSync(filePath, 'utf8');
  const statements = content
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  await conn.beginTransaction();
  try {
    for (const statement of statements) {
      await conn.query(statement);
    }
    await conn.query(`INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES (?)`, [filename]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

export async function runMigrations(): Promise<void> {
  const conn = await mysql.createConnection({ uri: env.DATABASE_URL, timezone: 'Z', charset: 'utf8mb4' });
  try {
    await ensureTable(conn);
    const onDisk = listSqlFiles();
    const applied = await appliedFiles(conn);

    // Drift: recorded migration missing from disk (deleted/renamed) -> refuse.
    const drift = [...applied].filter((f) => !onDisk.includes(f));
    if (drift.length > 0) {
      throw new Error(
        `Migration drift detected: applied migration(s) missing from disk: ${drift.join(', ')}. ` +
          'Refusing to continue — restore the files or reconcile the migrations table manually.',
      );
    }

    const pending = onDisk.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log(`[db:migrate] up to date (${onDisk.length} migration(s) applied).`);
      return;
    }
    for (const filename of pending) {
      await applyMigration(conn, filename);
      console.log(`[db:migrate] applied ${filename}`);
    }
    console.log(`[db:migrate] done: ${pending.length} applied, ${onDisk.length} total.`);
  } finally {
    await conn.end();
  }
}

// CLI entry: `bun run db:migrate` (tsx src/db/migrate.ts). Not imported elsewhere.
runMigrations()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[db:migrate] FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
