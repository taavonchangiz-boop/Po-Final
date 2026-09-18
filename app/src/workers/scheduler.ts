/**
 * Scheduler process entry: 60s tick loop, single-instance via Redis lock
 * `lock:scheduler` (SET NX EX 120 — auto-expires on crash; released after each
 * tick via compare-and-delete).
 *
 * Tick order (each step individually try/caught + logged):
 *   1. runScheduleTick      — due post schedules -> delivery jobs
 *   2. runGoldSchedulerTick — gold price fetch + scheduled publishing (wave-B)
 *   3. runExpiryNoticeTick  — 7-day subscription expiry notices (wave-B)
 *   4. refreshDailyStats    — analytics daily read model (wave-B)
 *   5. pollActiveBots       — getUpdates polling for webhook-less bots (wave-B)
 *   6. runRetentionTick     — hourly gate (counter) — bounded data cleanup
 *
 * Redis-unreachable policy: the lock cannot be verified, so ticks are SKIPPED
 * (conservative — never duplicate fan-out work) and logged; the loop keeps
 * trying, never crash-looping.
 */
import { randomToken } from '../core/crypto.js';
import { runRetentionTick } from '../core/maintenance.js';
import { logger } from '../core/logger.js';
import { pool } from '../db/client.js';
import { closeRedis, getRedis } from '../security/redis.js';
import { runScheduleTick } from '../modules/publishing/schedule.jobs.js';
// Cross-agent imports (wave 4-b): dictated export shapes; missing files surface
// as 'Cannot find module' only (orchestrator typechecks after both agents land).
import { runGoldSchedulerTick } from '../modules/gold/gold.jobs.js';
import { runExpiryNoticeTick } from '../modules/billing/expiry.jobs.js';
import { refreshDailyStats } from '../modules/analytics/stats.jobs.js';
import { pollActiveBots } from '../modules/bots/bot-polling.js';

const TICK_MS = 60_000;
const LOCK_KEY = 'lock:scheduler';
const LOCK_TTL_SECONDS = 120;
const REDIS_BOUND_MS = 3_000;
const RETENTION_EVERY_TICKS = 60; // hourly with 60s ticks

let stopping = false;
let timer: NodeJS.Timeout | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve with 'timeout' after ms — never rejects, so no unhandled rejections. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve('timeout');
      },
    );
  });
}

/** Compare-and-delete lock release (Lua for atomicity). */
const RELEASE_LOCK_LUA =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

async function acquireLock(): Promise<string | null> {
  const token = randomToken(8);
  const res = await withTimeout(getRedis().set(LOCK_KEY, token, 'EX', LOCK_TTL_SECONDS, 'NX'), REDIS_BOUND_MS);
  return res === 'OK' ? token : null;
}

async function releaseLock(token: string): Promise<void> {
  await withTimeout(getRedis().eval(RELEASE_LOCK_LUA, 1, LOCK_KEY, token), REDIS_BOUND_MS);
}

async function safeRun(label: string, fn: () => Promise<number>): Promise<void> {
  try {
    const started = Date.now();
    const processed = await fn();
    if (processed > 0) {
      logger.info('scheduler_step_done', { step: label, processed, durationMs: Date.now() - started });
    }
  } catch (err) {
    logger.error('scheduler_step_failed', { step: label, error: err instanceof Error ? err.message : String(err) });
  }
}

async function tick(counter: number): Promise<void> {
  const token = await acquireLock();
  if (token === null) {
    // Lock held by another instance (or Redis unreachable) — skip this tick.
    logger.debug('scheduler_tick_skipped', { reason: 'lock_not_acquired' });
    return;
  }
  try {
    await safeRun('schedule_tick', () => runScheduleTick());
    await safeRun('gold_scheduler', () => runGoldSchedulerTick());
    await safeRun('expiry_notice', () => runExpiryNoticeTick());
    await safeRun('daily_stats', () => refreshDailyStats());
    await safeRun('bot_polling', () => pollActiveBots());
    if (counter % RETENTION_EVERY_TICKS === 0) {
      await safeRun('retention', () => runRetentionTick());
    }
  } finally {
    await releaseLock(token);
  }
}

export async function startScheduler(): Promise<void> {
  logger.info('scheduler_starting', { tickMs: TICK_MS, lockKey: LOCK_KEY });
  let counter = 0;
  // Fire one tick immediately, then every 60s.
  void tick(counter++).catch((err: unknown) => {
    logger.error('scheduler_tick_failed', { error: err instanceof Error ? err.message : String(err) });
  });
  timer = setInterval(() => {
    if (stopping) return;
    void tick(counter++).catch((err: unknown) => {
      logger.error('scheduler_tick_failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }, TICK_MS);
  logger.info('scheduler_started');
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info('scheduler_shutdown', { signal });
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  // Allow an in-flight tick to finish (bounded by the Redis command timeouts).
  await sleep(1_000);
  await closeRedis();
  await pool.end().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

startScheduler().catch((err: unknown) => {
  logger.fatal('scheduler_start_failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
