/**
 * Auth service: registration (first-admin DB-mutex, ADR-007), login/logout,
 * password reset + change. Passwords are Argon2id (@node-rs/argon2).
 */
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { AnalyticsService } from '../../core/events.js';
import { randomToken, sha256Hex } from '../../core/crypto.js';
import { conflict, forbidden, internal, unauthenticated, validationError } from '../../core/errors.js';
import { db, withTransaction } from '../../db/client.js';
import {
  notifications,
  passwordResets,
  plans,
  referrals,
  sessions,
  subscriptions,
  systemBootstrap,
  users,
  wallets,
} from '../../db/schema.js';
import { SessionService } from '../../security/session.js';

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

export interface RegisterInput {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  businessName: string;
  businessType: string;
  password: string;
  referralCode?: string;
}

/** MySQL duplicate-key detection (ER_DUP_ENTRY / errno 1062). */
export function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; errno?: unknown };
  return e.code === 'ER_DUP_ENTRY' || e.errno === 1062;
}

/** Normalize common Iranian mobile prefixes to the canonical 09xxxxxxxxx form. */
export function normalizeMobile(raw: string): string {
  const trimmed = raw.replace(/[\s-]/g, '');
  if (/^\+98\d{10}$/.test(trimmed)) return `0${trimmed.slice(3)}`;
  if (/^0098\d{10}$/.test(trimmed)) return `0${trimmed.slice(4)}`;
  if (/^98\d{10}$/.test(trimmed)) return `0${trimmed.slice(2)}`;
  return trimmed;
}

const FREE_SUBSCRIPTION_DAYS = 3650; // FREE plan auto-activation (~10 years)
const PASSWORD_RESET_TTL_MINUTES = 30;

/** Generate an 8-char hex referral code, retrying on the (rare) collision. */
async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomToken(4); // 8 hex chars
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1);
    if (existing.length === 0) return code;
  }
  throw internal(new Error('referral_code_generation_failed'));
}

export interface RegisterResult {
  userId: number;
  role: UserRole;
  referralCode: string;
  sessionToken: string;
}

/**
 * Registration. FIRST-ADMIN RULE: inside the transaction we INSERT the single
 * system_bootstrap row (id=1) — duplicate key ⇒ someone else won the race ⇒
 * role USER, otherwise SUPER_ADMIN. Client-supplied role is always ignored.
 */
export async function registerUser(input: RegisterInput, req: FastifyRequest): Promise<RegisterResult> {
  const passwordHash = await hash(input.password);
  const email = input.email.trim().toLowerCase();
  const mobile = normalizeMobile(input.mobile);

  let role: UserRole = 'USER';
  let userId = 0;
  let referralCode = '';
  let wasReferred = false;

  await withTransaction(async (tx) => {
    try {
      await tx.insert(systemBootstrap).values({ id: 1 });
      role = 'SUPER_ADMIN';
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      role = 'USER';
    }

    referralCode = await generateUniqueReferralCode();

    let referredBy: number | null = null;
    let referrerCode: string | null = null;
    if (input.referralCode !== undefined && input.referralCode.trim().length > 0) {
      const referrer = await tx
        .select({ id: users.id, referralCode: users.referralCode })
        .from(users)
        .where(eq(users.referralCode, input.referralCode.trim()))
        .limit(1);
      if (referrer[0] !== undefined) {
        referredBy = referrer[0].id;
        referrerCode = referrer[0].referralCode;
      }
    }

    let insertedId = 0;
    try {
      const res = await tx
        .insert(users)
        .values({
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          mobile,
          email,
          businessName: input.businessName.trim(),
          businessType: input.businessType.trim(),
          passwordHash,
          role,
          referralCode,
          referredBy,
          acceptedTerms: true,
        });
      insertedId = Number(res[0]?.insertId ?? 0);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw conflict('این ایمیل یا شماره موبایل قبلاً ثبت شده است.');
      }
      throw err;
    }
    if (insertedId === 0) throw internal(new Error('user_insert_missing_id'));
    userId = insertedId;

    if (referredBy !== null && referrerCode !== null) {
      wasReferred = true;
      await tx.insert(referrals).values({
        referrerUserId: referredBy,
        referredUserId: userId,
        code: referrerCode,
        status: 'PENDING',
      });
    }

    await tx.insert(wallets).values({ userId, balance: 0, currency: 'IRR' });

    const freePlan = await tx.select({ id: plans.id }).from(plans).where(eq(plans.code, 'FREE')).limit(1);
    const freePlanId = freePlan[0]?.id;
    if (freePlanId !== undefined) {
      await tx.insert(subscriptions).values({
        userId,
        planId: freePlanId,
        status: 'ACTIVE',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + FREE_SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000),
      });
    }
  });

  const sessionToken = await SessionService.createSession(userId, req);

  AnalyticsService.trackEvent({
    userId,
    type: 'user.registration',
    subjectType: 'user',
    subjectId: userId,
    data: { role, referred: wasReferred },
  });

  return { userId, role, referralCode, sessionToken };
}

export interface LoginInput {
  mobile?: string;
  email?: string;
  password: string;
}

/** Login by mobile OR email; generic Persian error on every failure path. */
export async function loginUser(input: LoginInput, req: FastifyRequest): Promise<{ userId: number; role: UserRole; token: string }> {
  const candidates: Array<{ email: string } | { mobile: string }> = [];
  if (input.email !== undefined && input.email.trim().length > 0) {
    candidates.push({ email: input.email.trim().toLowerCase() });
  }
  if (input.mobile !== undefined && input.mobile.trim().length > 0) {
    candidates.push({ mobile: normalizeMobile(input.mobile) });
  }
  if (candidates.length === 0) {
    throw validationError('شماره موبایل یا ایمیل الزامی است.');
  }

  const condition = or(
    ...candidates.map((c) => ('email' in c ? eq(users.email, c.email) : eq(users.mobile, c.mobile))),
  );

  const rows = await db
    .select({
      id: users.id,
      role: users.role,
      status: users.status,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(condition)
    .limit(1);
  const user = rows[0];

  if (user === undefined) throw unauthenticated('اطلاعات ورود نادرست است.');

  const passwordOk = await verify(user.passwordHash, input.password).catch(() => false);
  if (!passwordOk) throw unauthenticated('اطلاعات ورود نادرست است.');

  if (user.status === 'SUSPENDED') {
    throw forbidden('حساب شما تعلیق شده است. با پشتیبانی تماس بگیرید.');
  }

  const token = await SessionService.createSession(user.id, req);
  await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));

  AnalyticsService.trackEvent({ userId: user.id, type: 'user.login', subjectType: 'user', subjectId: user.id });

  return { userId: user.id, role: user.role, token };
}

/** Logout: revoke the cookie session server-side (idempotent). */
export async function logoutUser(rawToken: string | undefined): Promise<{ userId: number | null }> {
  if (rawToken === undefined || rawToken.length === 0) return { userId: null };
  const resolved = await SessionService.resolveSession(rawToken);
  await SessionService.revokeSession(rawToken);
  if (resolved !== null) {
    AnalyticsService.trackEvent({ userId: resolved.user.id, type: 'user.logout', subjectType: 'user', subjectId: resolved.user.id });
    return { userId: resolved.user.id };
  }
  return { userId: null };
}

/** Request a password reset. Generic response regardless of account existence. */
export async function requestPasswordReset(identifier: { mobile?: string; email?: string }): Promise<void> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      identifier.email !== undefined && identifier.email.trim().length > 0
        ? eq(users.email, identifier.email.trim().toLowerCase())
        : eq(users.mobile, normalizeMobile(identifier.mobile ?? '')),
    )
    .limit(1);
  const user = rows[0];
  if (user === undefined) return; // silent — no account enumeration

  // Invalidate previous unused tokens (single active reset per user).
  await db.delete(passwordResets).where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));

  const token = randomToken(24);
  await db.insert(passwordResets).values({
    userId: user.id,
    tokenHash: sha256Hex(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
  });

  // Delivery is owned by the mail adapter (providers/email, unconfigured in v1
  // builds): the token is NEVER returned here; nothing is logged in production.
}

/** Confirm reset: single-use hashed token, revokes ALL sessions. */
export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const tokenHash = sha256Hex(token);
  const rows = await db.select().from(passwordResets).where(eq(passwordResets.tokenHash, tokenHash)).limit(1);
  const row = rows[0];
  if (row === undefined || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) {
    throw validationError('لینک بازیابی رمز عبور نامعتبر یا منقضی شده است.');
  }

  const passwordHash = await hash(newPassword);
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResets.id, row.id), isNull(passwordResets.usedAt)));
    if ((claimed[0]?.affectedRows ?? 0) === 0) {
      throw validationError('لینک بازیابی رمز عبور نامعتبر یا منقضی شده است.');
    }
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, row.userId), isNull(sessions.revokedAt)));
  });

  AnalyticsService.trackEvent({ userId: row.userId, type: 'user.password_reset', subjectType: 'user', subjectId: row.userId });
}

/** Change password (authenticated): verifies current, revokes OTHER sessions. */
export async function changePassword(
  userId: number,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const rows = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (user === undefined) throw unauthenticated();

  const ok = await verify(user.passwordHash, currentPassword).catch(() => false);
  if (!ok) throw validationError('رمز عبور فعلی نادرست است.');

  const passwordHash = await hash(newPassword);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
    // Revoke every other live session (keep the current device logged in).
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, currentSessionId)));
  });

  AnalyticsService.trackEvent({ userId, type: 'user.password_changed', subjectType: 'user', subjectId: userId });
}

export interface MeSummary {
  user: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    mobile: string;
    businessName: string;
    businessType: string;
    role: UserRole;
    referralCode: string | null;
    createdAt: Date;
  };
  plan: { code: string; name: string; expiresAt: Date } | null;
  unreadNotifications: number;
}

/** GET /me — user + tenant summary (active plan, unread notification count). */
export async function getMeSummary(userId: number): Promise<MeSummary> {
  const userRows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      mobile: users.mobile,
      businessName: users.businessName,
      businessType: users.businessType,
      role: users.role,
      referralCode: users.referralCode,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];
  if (user === undefined) throw unauthenticated();

  // Tenant summary reads: subscriptions/plans/notifications are other modules'
  // tables, but /me is a cross-domain read model; direct read-only SELECTs here
  // (no writes) keep the dependency graph acyclic until their services exist.
  const subRows = await db
    .select({ code: plans.code, name: plans.name, expiresAt: subscriptions.expiresAt })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'ACTIVE'), gt(subscriptions.expiresAt, new Date())))
    .orderBy(sql`${subscriptions.expiresAt} desc`)
    .limit(1);

  const unreadRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return {
    user,
    plan: subRows[0] ?? null,
    unreadNotifications: Number(unreadRows[0]?.count ?? 0),
  };
}
