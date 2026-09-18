/**
 * Fastify application factory: plugins, security, envelope, health routes.
 * Does NOT listen — src/server.ts owns the process lifecycle.
 */
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { sendCreated, sendOk, errorHandler } from '../core/envelope.js';
import { randomId } from '../core/crypto.js';
import { logger } from '../core/logger.js';
import { db } from '../db/client.js';
import { closeRedis, getRedis } from '../security/redis.js';
import { csrfPlugin } from '../security/csrf.js';
import { registerRateLimit } from '../security/rate-limit.js';
import { registerRoutes } from './registerRoutes.js';

const API_VERSION = '1.0.0';

/** Structured request logging through our zero-dep logger (fastify logger disabled). */
async function registerLoggerPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request) => {
    logger.debug('http_request_received', { requestId: request.id, method: request.method, url: request.url });
  });
  app.addHook('onResponse', async (request, reply) => {
    logger.info('http_response', {
      requestId: request.id,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime * 1000) / 1000,
      ip: request.ip,
    });
  });
  app.addHook('onRoute', () => {
    // placeholder for route metadata enforcement in later modules
  });
}

async function pingMysql(): Promise<boolean> {
  try {
    await Promise.race([db.execute(sql`SELECT 1`), sleep(2000).then(() => Promise.reject(new Error('timeout')))]);
    return true;
  } catch {
    return false;
  }
}

async function pingRedis(): Promise<boolean> {
  try {
    const result = await Promise.race([getRedis().ping(), sleep(2000).then(() => Promise.reject(new Error('timeout')))]);
    return result === 'PONG';
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // structured logging handled by registerLoggerPlugin
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: () => randomId(),
  });

  await registerLoggerPlugin(app);

  await app.register(helmet, {
    contentSecurityPolicy: false, // JSON API; CSP is a frontend concern
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  await app.register(cors, {
    origin: env.isProduction ? [env.APP_URL] : true,
    credentials: true,
  });

  await app.register(cookie, { secret: env.CSRF_SECRET });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  await registerRateLimit(app);
  await app.register(csrfPlugin);

  app.setErrorHandler(errorHandler());

  app.decorateReply('sendOk', function (this: FastifyReply, data: unknown, status = 200) {
    return sendOk(this, data, status);
  });
  app.decorateReply('sendCreated', function (this: FastifyReply, data: unknown) {
    return sendCreated(this, data);
  });

  // Health routes (outside /api/v1 namespace per contract).
  app.get('/health/live', async () => ({ ok: true }));

  app.get('/health/ready', async (_request, reply) => {
    const [mysqlOk, redisOk] = await Promise.all([pingMysql(), pingRedis()]);
    const status = mysqlOk && redisOk ? 'ok' : 'degraded';
    const code = mysqlOk && redisOk ? 200 : 503;
    return reply.status(code).send({ status, checks: { mysql: mysqlOk, redis: redisOk } });
  });

  app.get('/health', async () => ({
    name: 'postyar',
    version: API_VERSION,
    env: env.NODE_ENV,
    uptime: Math.round(process.uptime()),
  }));

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'مسیر یافت نشد.', requestId: request.id },
    });
  });

  registerRoutes(app);

  return app;
}

// Re-exported for worker/scheduler close paths.
export { closeRedis };
