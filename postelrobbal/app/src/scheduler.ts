import { loadEnv } from './config/env.js';
process.title = 'postyar-scheduler';
import { createLogger } from './core/logger.js';
import { getRedis, closeRedis } from './queue/connection.js';
import { closeQueues, enqueue } from './queue/queues.js';
import { closeDb, getDb } from './db/client.js';
import { relayOutbox } from './core/outbox.js';
import { outboxDispatcher } from './workers/dispatcher.js';
import { runSchedulerTick } from './workers/scheduler.tick.js';

/**
 * Scheduler entry — tick model (§126-127): invoked by cron every minute,
 * acquires a Redis lock, claims due work into queues, relays the outbox,
 * exits. Never spawns unbounded processes.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger('scheduler');
  const redis = getRedis();
  const lock = await redis.set(env.SCHEDULER_LOCK_KEY, String(process.pid), 'EX', 55, 'NX');
  if (lock !== 'OK') {
    // Another scheduler instance holds the tick — exit quietly (§68).
    await closeRedis();
    return;
  }

  try {
    const relayed = await relayOutbox(outboxDispatcher);
    const result = await runSchedulerTick();
    log.info({ relayed, ...result }, 'scheduler_tick_complete');
  } catch (err) {
    log.error({ err }, 'scheduler_tick_failed');
  } finally {
    await closeQueues();
    await closeRedis();
    await closeDb();
    void getDb; // keep import stable for future in-tick reads
    void enqueue;
    process.exit(0);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[scheduler] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
