/**
 * API process entry: buildApp() -> listen 0.0.0.0:PORT, graceful shutdown.
 * Run: bun run dev | node dist/server.js
 */
import { buildApp } from './app/buildApp.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { pool } from './db/client.js';
import { closeQueues } from './queue/queues.js';
import { closeRedis } from './security/redis.js';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info('server_started', { port: env.PORT, nodeEnv: env.NODE_ENV, version: '1.0.0' });
} catch (err) {
  logger.fatal('server_listen_failed', {
    port: env.PORT,
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_started', { signal });
  try {
    await app.close(); // stop intake, wait for in-flight handlers
    await closeQueues();
    await closeRedis();
    await pool.end();
    logger.info('shutdown_complete');
    process.exit(0);
  } catch (err) {
    logger.error('shutdown_failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
