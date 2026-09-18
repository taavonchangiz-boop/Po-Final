/**
 * ioredis singleton for BullMQ + health checks.
 * - lazyConnect: no eager connection (tolerates Redis being down at boot)
 * - maxRetriesPerRequest: null (required by BullMQ)
 */
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client === null) {
    client = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      retryStrategy: (times: number) => Math.min(times * 500, 5000),
    });
    // Without an 'error' listener ioredis raises unhandled error events when Redis is down.
    client.on('error', (err: Error) => {
      logger.warn('redis_error', { error: err.message });
    });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client === null) return;
  const c = client;
  client = null;
  // A client that never reached `ready` cannot QUIT (command would sit in the
  // offline queue forever) — hard-disconnect instead.
  if (c.status !== 'ready') {
    c.disconnect();
    return;
  }
  try {
    await c.quit();
  } catch {
    c.disconnect();
  }
}
