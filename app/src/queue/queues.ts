/**
 * BullMQ queue registry (ADR-004): deliveries, ai-jobs, wp-sync,
 * notifications, maintenance. enqueue() never throws — it returns false when
 * Redis is unavailable so callers can record outbox/pending state instead.
 */
import { Queue } from 'bullmq';
import { logger } from '../core/logger.js';
import { getRedis } from '../security/redis.js';

export const QUEUE_NAMES = ['deliveries', 'ai-jobs', 'wp-sync', 'notifications', 'maintenance'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

const queues = new Map<QueueName, Queue>();

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 3600 * 24 * 7, count: 5000 },
  removeOnFail: { age: 3600 * 24 * 14 },
} as const;

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;
  const queue = new Queue(name, {
    connection: getRedis(),
    defaultJobOptions,
  });
  queue.on('error', (err: Error) => {
    logger.error('queue_error', { queue: name, error: err.message });
  });
  queues.set(name, queue);
  return queue;
}

/** Add a job; returns false (and logs) instead of throwing when Redis is down. */
export async function enqueue(name: QueueName, jobName: string, data: unknown, opts?: Record<string, unknown>): Promise<boolean> {
  try {
    await getQueue(name).add(jobName, data, opts);
    return true;
  } catch (err) {
    logger.error('enqueue_failed', {
      queue: name,
      job: jobName,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function closeQueues(): Promise<void> {
  for (const [name, queue] of queues) {
    try {
      await queue.close();
    } catch (err) {
      logger.warn('queue_close_failed', { queue: name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  queues.clear();
}
