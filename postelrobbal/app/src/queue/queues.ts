import { Queue } from 'bullmq';
import { createQueue } from './connection.js';
import { loadEnv } from '../config/env.js';

/** Typed queue registry with bounded retention (§108). */
export const QUEUE_NAMES = ['delivery', 'bot-events', 'ai-jobs', 'notifications', 'maintenance'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;
  const q = createQueue(name);
  q.on('error', () => {
    /* logged by BullMQ default reporter; retention keeps Redis bounded */
  });
  queues.set(name, q);
  return q;
}

const JOB_RETENTION = { removeOnComplete: { age: 24 * 3600, count: 5000 }, removeOnFail: { age: 7 * 24 * 3600, count: 5000 } };

export async function enqueue(
  name: QueueName,
  jobName: string,
  data: Record<string, unknown>,
  opts: { jobId?: string; delayMs?: number } = {}
): Promise<void> {
  const env = loadEnv();
  if (env.DISABLE_QUEUE) return; // test-mode escape hatch; real deployments always queue
  await getQueue(name).add(jobName, data, {
    jobId: opts.jobId,
    delay: opts.delayMs,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    ...JOB_RETENTION,
  });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
