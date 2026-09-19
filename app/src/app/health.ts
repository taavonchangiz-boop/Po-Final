import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { loadEnv } from '../config/env.js';

/**
 * Health endpoints (§56, §128). /live is dependency-independent.
 * /ready performs REAL checks — never fakes readiness.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/live', async () => ({ status: 'live', time: new Date().toISOString() }));

  app.get('/ready', async () => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    let ready = true;

    const started = Date.now();
    try {
      const db = getDb();
      await db.execute(sql`SELECT 1`);
      checks.mysql = { ok: true, detail: `${Date.now() - started}ms` };
    } catch (err) {
      ready = false;
      checks.mysql = { ok: false, detail: (err as Error).message.slice(0, 120) };
    }

    try {
      const { getRedis } = await import('../queue/connection.js');
      const redis = getRedis();
      const pong = await redis.ping();
      checks.redis = { ok: pong === 'PONG' };
      if (pong !== 'PONG') ready = false;
    } catch (err) {
      ready = false;
      checks.redis = { ok: false, detail: (err as Error).message.slice(0, 120) };
    }

    const env = loadEnv();
    return { status: ready ? 'ready' : 'degraded', checks, env: env.NODE_ENV };
  });

  app.get('/', async () => ({ status: 'ok', service: 'postyar-api' }));
}
