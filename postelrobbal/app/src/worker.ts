import { loadEnv } from './config/env.js';
process.title = 'postyar-worker';
import { createLogger } from './core/logger.js';
import { getRedis, closeRedis } from './queue/connection.js';
import { closeQueues } from './queue/queues.js';
import { closeDb } from './db/client.js';
import { startDeliveryWorker } from './workers/delivery.worker.js';
import { startBotEventWorker } from './workers/botEvent.worker.js';
import { startAiWorker } from './workers/ai.worker.js';
import { startNotificationWorker } from './workers/notification.worker.js';
import { startMaintenanceWorker } from './workers/maintenance.worker.js';

/**
 * Worker entry — single instance (§54, §68). Bounded concurrency, graceful
 * shutdown, closes Redis/DB cleanly (§111).
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger('worker');
  getRedis(); // fail fast when Redis is unreachable

  const workers = [
    startDeliveryWorker(),
    startBotEventWorker(),
    startAiWorker(),
    startNotificationWorker(),
    startMaintenanceWorker(),
  ];

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'worker_shutdown_begin');
    try {
      await Promise.all(workers.map((w) => w.close()));
      await closeQueues();
      await closeRedis();
      await closeDb();
      log.info('worker_shutdown_complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'worker_shutdown_error');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker_started');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
