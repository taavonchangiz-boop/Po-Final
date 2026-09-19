import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool, closeDb } from './client.js';

/**
 * Deterministic migration runner (§66).
 * Applies committed .sql files in lexical order, exactly once.
 * Detects drift: if the DB is ahead/unknown, aborts instead of guessing (§201).
 */
export async function runMigrations(migrationsDir: string): Promise<string[]> {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(190) PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const [appliedRows] = await pool.query<RowDataPacket[]>('SELECT name FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => String(r.name)));

  const unknown = [...applied].filter((a) => !files.includes(a));
  if (unknown.length > 0) {
    throw new Error(`Schema drift detected: applied migration(s) not present in release: ${unknown.join(', ')}. Aborting.`);
  }

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sqlText = await readFile(path.join(migrationsDir, file), 'utf8');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(sqlText);
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      await conn.commit();
      newlyApplied.push(file);
    } catch (err) {
      await conn.rollback();
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      conn.release();
    }
  }
  return newlyApplied;
}

if (process.argv[1] && /migrate-cli\.(ts|js)$/.test(process.argv[1])) {
  const dir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), '../database/migrations');
  runMigrations(dir)
    .then((applied) => {
      // eslint-disable-next-line no-console
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
      return closeDb();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err.message);
      process.exit(1);
    });
}
