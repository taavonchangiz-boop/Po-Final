/**
 * CSRF double-submit (ADR-006): `py_csrf` cookie (readable) + `X-CSRF-Token`
 * header equality on mutating requests. Safe methods ensure the cookie exists.
 * Routes may opt out via route `config: { csrf: false }` (public webhooks).
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import { env } from '../config/env.js';
import { randomToken, timingSafeEqualStr } from '../core/crypto.js';
import { forbidden } from '../core/errors.js';

export const CSRF_COOKIE = 'py_csrf';
export const CSRF_HEADER = 'x-csrf-token';

function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function routeOptsOut(request: FastifyRequest): boolean {
  const config = request.routeOptions?.config as { csrf?: boolean } | undefined;
  return config?.csrf === false;
}

/** Ensure the readable CSRF cookie exists (double-submit half #1). */
export function ensureCsrfCookie(request: FastifyRequest, reply: FastifyReply): void {
  const existing = request.cookies[CSRF_COOKIE];
  if (existing !== undefined && existing.length > 0) return;
  reply.setCookie(CSRF_COOKIE, randomToken(32), {
    path: '/',
    sameSite: 'lax',
    httpOnly: false, // must be readable by the SPA to echo into the header
    secure: env.isProduction,
  });
}

/** Verify header token equals cookie token (double-submit half #2). */
export function verifyCsrf(request: FastifyRequest): void {
  const cookie = request.cookies[CSRF_COOKIE];
  const header = request.headers[CSRF_HEADER];
  if (
    cookie === undefined ||
    typeof header !== 'string' ||
    header.length === 0 ||
    !timingSafeEqualStr(cookie, header)
  ) {
    throw forbidden('درخواست به دلیل اعتبارسنجی CSRF رد شد. صفحه را بازخوانی کنید.');
  }
}

/** Registers the global preHandler: ensure on safe methods, verify on mutations. */
export const csrfPlugin: FastifyPluginAsync = async (app: FastifyInstance): Promise<void> => {
  app.addHook('preHandler', async (request, reply) => {
    if (isSafeMethod(request.method)) {
      ensureCsrfCookie(request, reply);
      return;
    }
    if (routeOptsOut(request)) return;
    verifyCsrf(request);
  });
};
