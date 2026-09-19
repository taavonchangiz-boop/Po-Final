import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { loadEnv, isProduction } from '../config/env.js';
import { AppError, toPublicError, ERR } from '../core/errors.js';
import { resolveSession, SessionUser } from '../security/sessions.js';
import { verifyCsrfToken } from '../security/csrf.js';
import { roleHasPermission, Permission } from '../security/permissions.js';
import { healthRoutes } from './health.js';

export interface AuthedRequest extends FastifyRequest {
  user?: SessionUser;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger: false, // request logging via hook below (pino with request ids)
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024, // §197 bounded payloads
    genReqId: () => randomUUID(),
    disableRequestLogging: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: isProduction(env) ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  await app.register(cookie, { secret: env.SESSION_SECRET, parseOptions: { sameSite: 'lax' } });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    redis: undefined, // in-memory store: single API process per deployment contract
  });

  // request id + observability (§129)
  app.addHook('onRequest', async (req) => {
    (req.raw as unknown as { startedAt: number }).startedAt = Date.now();
  });
  app.addHook('onResponse', async (req, reply) => {
    const startedAt = (req.raw as unknown as { startedAt?: number }).startedAt ?? Date.now();
    reply.log.info({
      method: req.method,
      url: req.url,
      status: reply.statusCode,
      durationMs: Date.now() - startedAt,
      requestId: req.id,
    }, 'http_request');
  });

  // session resolution
  app.addHook('onRequest', async (req) => {
    const token = req.cookies['py_session'];
    const session = await resolveSession(token);
    if (session) {
      req.user = session;
      // CSRF for mutating requests (skip provider webhooks registered separately)
      if (MUTATING.has(req.method) && !req.url.startsWith('/api/v1/webhooks') && !req.url.startsWith('/api/v1/payments/callback')) {
        const header = req.headers['x-csrf-token'];
        if (!verifyCsrfToken(Array.isArray(header) ? header[0] : header, session.csrfSecret)) {
          throw new AppError(ERR.CSRF_INVALID());
        }
      }
    }
  });

  // auth decorators
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  });
  app.decorate('requirePermission', (permission: Permission) => async (req: FastifyRequest) => {
    if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
    if (!roleHasPermission(req.user.role, permission)) throw new AppError(ERR.FORBIDDEN());
  });

  // unified error handler (§58): stable code + safe Persian message + requestId
  app.setErrorHandler((err, req, reply: FastifyReply) => {
    if (err instanceof AppError) {
      void reply.status(err.httpStatus).send({
        success: false,
        error: { code: err.code, message: err.userMessage, requestId: req.id },
      });
      return;
    }
    if (typeof (err as { statusCode?: number }).statusCode === 'number') {
      const status = (err as { statusCode?: number }).statusCode as number;
      if (status === 429) {
        void reply.status(429).send({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد تلاش کنید.', requestId: req.id },
        });
        return;
      }
      if (status === 413) {
        void reply.status(413).send({
          success: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'حجم فایل یا دادهٔ ارسالی بیش از حد مجاز است.', requestId: req.id },
        });
        return;
      }
      if (status >= 400 && status < 500) {
        void reply.status(status).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'درخواست معتبر نیست.', requestId: req.id },
        });
        return;
      }
    }
    req.log.error({ err }, 'unhandled_error');
    const pub = toPublicError(err);
    void reply.status(pub.httpStatus).send({
      success: false,
      error: { code: pub.code, message: pub.userMessage, requestId: req.id },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'مسیر مورد نظر یافت نشد.', requestId: req.id },
    });
  });

  await app.register(healthRoutes, { prefix: '/health' });

  return app;
}

// Fastify type augmentation for decorators
declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest) => Promise<void>;
    requirePermission: (permission: Permission) => (req: FastifyRequest) => Promise<void>;
  }
}
