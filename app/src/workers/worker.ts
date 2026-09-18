/**
 * Worker process entry (ADR-004): BullMQ consumers for the five queues.
 *
 *   deliveries     concurrency 3  — job 'send' -> runDeliveryJob,
 *                                   job 'outbox-dispatch' -> outbox pump
 *   ai-jobs        concurrency 2  — runAiJob (wave-B module)
 *   wp-sync        concurrency 1  — runWpSync (wave-B module)
 *   notifications  concurrency 2  — job 'channel-send' -> runChannelNotification
 *   maintenance    concurrency 1  — job 'tick' -> outbox pump,
 *                                   job 'retention' -> runRetentionTick
 *
 * Outbox pump (ADR-008 bridge): claims due outbox rows and maps event types to
 * queue jobs; enqueue failures requeue the row (PENDING, +60s) so nothing is
 * lost while Redis is unavailable.
 *
 * Redis-unreachable policy: wait-loop with 30s retry (never crash-loops);
 * ioredis + BullMQ keep retrying in the background once started.
 */
import { Worker, type Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { env } from '../config/env.js';
import { runRetentionTick } from '../core/maintenance.js';
import { claimOutbox } from '../core/outbox.js';
import { logger } from '../core/logger.js';
import { db, pool } from '../db/client.js';
import { deliveries, outboxEvents } from '../db/schema.js';
import { closeQueues, enqueue, QUEUE_NAMES, type QueueName } from '../queue/queues.js';
import { closeRedis, getRedis } from '../security/redis.js';
import { runDeliveryJob } from '../modules/publishing/delivery.worker.js';
// Cross-agent imports (wave 4-b): these modules are built by another agent.
// Dictated export shapes — missing files surface as 'Cannot find module' only.
import { runAiJob } from '../modules/ai/ai.worker.js';
import { runWpSync } from '../modules/wordpress/wordpress.worker.js';
import { runChannelNotification } from '../modules/notifications/notifications.worker.js';
import type { ProviderButton } from '../providers/types.js';

const CONCURRENCY: Record<QueueName, number> = {
  deliveries: 3,
  'ai-jobs': 2,
  'wp-sync': 1,
  notifications: 2,
  maintenance: 1,
};

const OUTBOX_BATCH = 50;
const REDIS_WAIT_MS = 30_000;

let stopping = false;
const workers: Worker[] = [];

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

/* ------------------------------ outbox pump ------------------------------- */

interface FanoutTarget {
  channelId: number;
  text: string;
  buttons?: ProviderButton[][];
}

async function dispatchOutbox(): Promise<number> {
  const events = await claimOutbox(OUTBOX_BATCH);
  for (const ev of events) {
    let ok = true;
    try {
      switch (ev.eventType) {
        case 'post.created': {
          const postId = Number((ev.payload as { postId?: unknown }).postId);
          if (Number.isFinite(postId) && postId > 0) {
            const rows = await db
              .select({ id: deliveries.id })
              .from(deliveries)
              .where(and(eq(deliveries.postId, postId), inArray(deliveries.state, ['PENDING'])));
            for (const row of rows) {
              const sent = await enqueue('deliveries', 'send', { deliveryId: row.id });
              if (!sent) ok = false;
            }
          }
          break;
        }
        case 'notification.fanout': {
          const payload = ev.payload as {
            channels?: FanoutTarget[];
            channelId?: number;
            text?: string;
            buttons?: ProviderButton[][];
          };
          const targets: FanoutTarget[] =
            payload.channels ??
            (payload.channelId !== undefined && payload.text !== undefined
              ? [{ channelId: Number(payload.channelId), text: String(payload.text), buttons: payload.buttons }]
              : []);
          for (const t of targets) {
            const sent = await enqueue('notifications', 'channel-send', { channelId: t.channelId, text: t.text, buttons: t.buttons });
            if (!sent) ok = false;
          }
          break;
        }
        case 'ai.requested': {
          const jobId = Number((ev.payload as { jobId?: unknown }).jobId);
          if (Number.isFinite(jobId) && jobId > 0) {
            const sent = await enqueue('ai-jobs', 'run', { jobId });
            if (!sent) ok = false;
          }
          break;
        }
        case 'wp.sync': {
          const siteId = Number((ev.payload as { siteId?: unknown }).siteId);
          if (Number.isFinite(siteId) && siteId > 0) {
            const sent = await enqueue('wp-sync', 'sync', { siteId });
            if (!sent) ok = false;
          }
          break;
        }
        default:
          // Unknown event types are marked DONE to avoid infinite redelivery.
          logger.warn('outbox_unknown_event_type', { eventType: ev.eventType, id: ev.id });
          break;
      }
    } catch (err) {
      ok = false;
      logger.error('outbox_dispatch_error', { id: ev.id, eventType: ev.eventType, error: err instanceof Error ? err.message : String(err) });
    }

    if (ok) {
      await db.update(outboxEvents).set({ status: 'DONE', processedAt: new Date() }).where(eq(outboxEvents.id, ev.id));
    } else {
      // Redis/queue hiccup: requeue for the next pump pass (claim already
      // incremented attempts; availability is pushed 60s into the future).
      await db
        .update(outboxEvents)
        .set({ status: 'PENDING', availableAt: new Date(Date.now() + 60_000) })
        .where(eq(outboxEvents.id, ev.id));
    }
  }
  return events.length;
}

/* ------------------------------- processors ------------------------------- */

type JobProcessor = (job: Job) => Promise<unknown>;

function makeProcessor(queue: QueueName): JobProcessor {
  return async (job: Job): Promise<unknown> => {
    switch (queue) {
      case 'deliveries': {
        if (job.name === 'outbox-dispatch') {
          return { dispatched: await dispatchOutbox() };
        }
        if (job.name === 'send') {
          const data = job.data as { deliveryId?: unknown };
          const deliveryId = Number(data.deliveryId);
          const result = await runDeliveryJob({ deliveryId });
          if (result.status === 'RETRY' && result.retryAfterSeconds !== undefined) {
            // DB row is RETRYING with nextAttemptAt; the delayed job fires at
            // the backoff boundary (claim CAS keeps duplicates harmless).
            await enqueue('deliveries', 'send', { deliveryId }, { delay: result.retryAfterSeconds * 1000 });
          }
          return result;
        }
        return { ignored: job.name };
      }
      case 'ai-jobs': {
        const data = job.data as { jobId?: unknown };
        return runAiJob({ jobId: Number(data.jobId) });
      }
      case 'wp-sync': {
        const data = job.data as { siteId?: unknown };
        await runWpSync({ siteId: Number(data.siteId) });
        return { ok: true };
      }
      case 'notifications': {
        const data = job.data as { channelId?: unknown; text?: unknown; buttons?: ProviderButton[][] };
        return runChannelNotification({
          channelId: Number(data.channelId),
          text: String(data.text ?? ''),
          buttons: data.buttons,
        });
      }
      case 'maintenance': {
        if (job.name === 'tick') return { dispatched: await dispatchOutbox() };
        if (job.name === 'retention') return { deleted: await runRetentionTick() };
        return { ignored: job.name };
      }
    }
  };
}

/* --------------------------------- startup -------------------------------- */

async function waitForRedis(): Promise<void> {
  const client = getRedis();
  for (let attempt = 1; !stopping; attempt++) {
    const status = client.status;
    if (status === 'ready') {
      const pong = await withTimeout(client.ping(), 5_000);
      if (pong === 'PONG') return;
    } else if (status === 'wait' || status === 'end') {
      // Kick off the connection in the background; failures resurface through
      // the retry loop and the shared 'error' listener.
      void client.connect().catch(() => undefined);
    }
    logger.warn('worker_redis_unreachable', { attempt, status: client.status, retryInMs: REDIS_WAIT_MS });
    await sleep(REDIS_WAIT_MS);
  }
}

export async function startWorker(): Promise<void> {
  logger.info('worker_starting', { env: env.NODE_ENV, queues: QUEUE_NAMES });
  await waitForRedis();
  if (stopping) return;

  for (const name of QUEUE_NAMES) {
    const worker = new Worker(name, makeProcessor(name), {
      connection: getRedis(),
      concurrency: CONCURRENCY[name],
    });
    worker.on('completed', (job: Job) => {
      logger.debug('worker_job_completed', { queue: name, job: job.name, jobId: job.id });
    });
    worker.on('failed', (job: Job | undefined, err: Error) => {
      logger.error('worker_job_failed', { queue: name, job: job?.name, jobId: job?.id, error: err.message });
    });
    worker.on('error', (err: Error) => {
      logger.error('worker_error', { queue: name, error: err.message });
    });
    workers.push(worker);
  }
  logger.info('worker_started', { queues: QUEUE_NAMES, concurrency: CONCURRENCY });
}

/* -------------------------------- shutdown -------------------------------- */

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info('worker_shutdown', { signal });

  for (const worker of workers) {
    try {
      await worker.close();
    } catch (err) {
      logger.warn('worker_close_failed', { queue: worker.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  workers.length = 0;

  await closeQueues();
  await closeRedis();
  await pool.end().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

startWorker().catch((err: unknown) => {
  logger.fatal('worker_start_failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
