/**
 * Session lifecycle (ADR-006): opaque HttpOnly-cookie sessions, SHA-256
 * token hashes at rest, revocation/rotation, throttled sliding lastSeenAt.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, isNull, lt, ne } from 'drizzle-orm';
import '@fastify/cookie';
import { env } from '../config/env.js';
import { randomId, randomToken, sha256Hex } from '../core/crypto.js';
import { forbidden, unauthenticated } from '../core/errors.js';
import { db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import type { CurrentUser } from '../plugins/auth.js';

export const SESSION_COOKIE = 'py_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const LAST_SEEN_THROTTLE_MS = 60_000;

const BASE_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
} as const;

export interface SessionRow {
  session: typeof sessions.$inferSelect;
  user: {
    id: number;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
    status: 'ACTIVE' | 'SUSPENDED';
    email: string;
    firstName: string;
    lastName: string;
    businessName: string;
  };
}

function requestMeta(req: FastifyRequest): { ip: string | null; userAgent: string | null } {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 255) : null,
  };
}

export const SessionService = {
  /** Create a session row; returns the raw bearer-cookie token (shown once). */
  async createSession(userId: number, req: FastifyRequest): Promise<string> {
    const token = randomToken(32);
    const { ip, userAgent } = requestMeta(req);
    await db.insert(sessions).values({
      id: randomId(),
      userId,
      tokenHash: sha256Hex(token),
      ip,
      userAgent,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    });
    return token;
  },

  setSessionCookie(reply: FastifyReply, token: string): FastifyReply {
    return reply.setCookie(SESSION_COOKIE, token, {
      ...BASE_COOKIE_OPTIONS,
      httpOnly: true,
      maxAge: SESSION_TTL_SECONDS,
    });
  },

  clearSessionCookie(reply: FastifyReply): FastifyReply {
    return reply.clearCookie(SESSION_COOKIE, { ...BASE_COOKIE_OPTIONS, httpOnly: true });
  },

  /** Resolve a raw token to session + user; expired/revoked tokens resolve to null. */
  async resolveSession(token: string): Promise<SessionRow | null> {
    const rows = await db
      .select({
        session: sessions,
        user: {
          id: users.id,
          role: users.role,
          status: users.status,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          businessName: users.businessName,
        },
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return rows[0] ?? null;
  },

  async revokeSession(token: string): Promise<void> {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256Hex(token)));
  },

  /** Revoke all live sessions for a user (optionally keeping one, e.g. current). */
  async revokeAllForUser(userId: number, exceptSessionId?: string): Promise<void> {
    const where =
      exceptSessionId !== undefined
        ? and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, exceptSessionId))
        : and(eq(sessions.userId, userId), isNull(sessions.revokedAt));
    await db.update(sessions).set({ revokedAt: new Date() }).where(where);
  },

  /** Revoke old session and issue a fresh one (privileged-action rotation). */
  async rotateSession(oldToken: string, userId: number, req: FastifyRequest): Promise<string> {
    await SessionService.revokeSession(oldToken);
    return SessionService.createSession(userId, req);
  },

  /** Throttled sliding lastSeenAt update (at most once per 60s per session). */
  async touchLastSeen(sessionId: string): Promise<void> {
    const threshold = new Date(Date.now() - LAST_SEEN_THROTTLE_MS);
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(sessions.id, sessionId), lt(sessions.lastSeenAt, threshold)));
  },
};

/**
 * requireAuth preHandler: cookie -> session -> user; sets request.currentUser.
 * SUSPENDED users are rejected with FORBIDDEN.
 */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (token === undefined || token.length === 0) throw unauthenticated();

  const row = await SessionService.resolveSession(token);
  if (row === null) throw unauthenticated();
  if (row.user.status === 'SUSPENDED') throw forbidden('حساب شما تعلیق شده است. با پشتیبانی تماس بگیرید.');

  const currentUser: CurrentUser = {
    id: row.user.id,
    role: row.user.role,
    status: row.user.status,
    email: row.user.email,
  };
  request.currentUser = currentUser;

  void SessionService.touchLastSeen(row.session.id).catch(() => undefined);
}
