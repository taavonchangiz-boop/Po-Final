import { and, count, desc, eq, gte, ne, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import {
  users,
  subscriptions,
  payments,
  postTargets,
  plans,
  auditLogs,
  systemSettings,
  channelRegistry,
  posts,
  channels,
  bots,
  media,
  tickets,
  aiJobs,
  goldConfigs,
  goldSnapshots,
} from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { PlanLimits, PlanFeatures } from '../../db/schema.js';
import { notifyTenant } from '../notifications/delivery.js';
import { activateSubscription, activateSubscriptionTx } from '../subscriptions/plan.service.js';
import { moveMoneyTx } from '../wallet/wallet.service.js';
import { revokeAllUserSessions } from '../../security/sessions.js';
import { referralHookFirstPurchase } from '../payments/payment.service.js';
import { getPaymentSettings } from '../payments/payment-settings.service.js';

export interface AdminOverview {
  users: { total: number; active: number; suspended: number; new30d: number };
  channels: { total: number; active: number; telegram: number; bale: number; rubika: number };
  bots: { total: number; active: number; telegram: number; bale: number; rubika: number };
  gold: { configs: number; enabled: number; snapshots24h: number };
  posts: { total: number; scheduled: number; published30d: number; failed24h: number };
  payments: { verifiedCount30d: number; verifiedSum30d: number; verifiedSumTotal: number; pendingReview: number };
  subscriptions: { active: number; byPlan: Array<{ planName: string; count: number }> };
  usage: {
    aiJobs30d: number;
    mediaCount: number;
    mediaBytes: number;
    ticketsOpen: number;
    deliveries24h: number;
    deliveriesFailed24h: number;
  };
}

const num = (v: unknown): number => Number(v ?? 0);

type CountRow = { value: number };
type SumRow = { sum: string | number | null };
type MediaRow = { value: number; bytes: string | number | null };
type PlatformRow = { platform: string; value: number };
type PlanCountRow = { planName: string; value: number };

/** Runs thunks with bounded concurrency (pool: connectionLimit=DB_POOL_MAX=5,
 *  queueLimit=20 — an unbounded Promise.all of 27 queries overflows the queue
 *  and mysql2 aborts with "Queue limit reached"). */
async function mapLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      const task = tasks[i];
      if (task === undefined) break;
      results[i] = await task();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Dashboard overview (admin-panel v2 nested shape).
 * Semantics verified against the real schema enums:
 *  - channels/bots: status 'ACTIVE' = connected; platform counts cover all rows.
 *  - post_targets states: PENDING|PROCESSING|SENT|RETRYING|FAILED|CANCELLED —
 *    successful deliveries are state 'SENT' (there is no PUBLISHED target state).
 *  - tickets states: OPEN|ANSWERED|CLOSED — open = state != CLOSED.
 */
export async function getOverview(): Promise<AdminOverview> {
  const db = getDb();
  const since30d = new Date(Date.now() - 30 * 86400_000);
  const since24h = new Date(Date.now() - 24 * 3600_000);

  const results = await mapLimit<unknown>([
    () => db.select({ value: count() }).from(users),
    () => db.select({ value: count() }).from(users).where(eq(users.status, 'ACTIVE')),
    () => db.select({ value: count() }).from(users).where(eq(users.status, 'SUSPENDED')),
    () => db.select({ value: count() }).from(users).where(gte(users.createdAt, since30d)),
    () => db.select({ value: count() }).from(channels),
    () => db.select({ value: count() }).from(channels).where(eq(channels.status, 'ACTIVE')),
    () => db.select({ platform: channels.platform, value: count() }).from(channels).groupBy(channels.platform),
    () => db.select({ value: count() }).from(bots),
    () => db.select({ value: count() }).from(bots).where(eq(bots.status, 'ACTIVE')),
    () => db.select({ platform: bots.platform, value: count() }).from(bots).groupBy(bots.platform),
    () => db.select({ value: count() }).from(goldConfigs),
    () => db.select({ value: count() }).from(goldConfigs).where(eq(goldConfigs.isEnabled, 1)),
    () => db.select({ value: count() }).from(goldSnapshots).where(gte(goldSnapshots.capturedAt, since24h)),
    () => db.select({ value: count() }).from(posts),
    () => db.select({ value: count() }).from(posts).where(eq(posts.state, 'SCHEDULED')),
    () => db.select({ value: count() }).from(posts).where(and(eq(posts.state, 'PUBLISHED'), gte(posts.publishedAt, since30d))),
    () => db.select({ value: count() }).from(postTargets).where(and(eq(postTargets.state, 'FAILED'), gte(postTargets.updatedAt, since24h))),
    () => db.select({ value: count() }).from(postTargets).where(and(eq(postTargets.state, 'SENT'), gte(postTargets.updatedAt, since24h))),
    () => db.select({ value: count() }).from(payments).where(and(eq(payments.state, 'VERIFIED'), gte(payments.verifiedAt, since30d))),
    () => db.select({ value: count() }).from(payments).where(eq(payments.state, 'PENDING_REVIEW')),
    () => db.select({ sum: sql<string | number | null>`COALESCE(SUM(${payments.amountRial}), 0)` }).from(payments).where(and(eq(payments.state, 'VERIFIED'), gte(payments.verifiedAt, since30d))),
    () => db.select({ sum: sql<string | number | null>`COALESCE(SUM(${payments.amountRial}), 0)` }).from(payments).where(eq(payments.state, 'VERIFIED')),
    () => db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.state, 'ACTIVE')),
    () => db
      .select({ planName: plans.nameFa, value: count() })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.state, 'ACTIVE'))
      .groupBy(plans.nameFa),
    () => db.select({ value: count() }).from(aiJobs).where(gte(aiJobs.createdAt, since30d)),
    () => db.select({ value: count(), bytes: sql<string | number | null>`COALESCE(SUM(${media.sizeBytes}), 0)` }).from(media),
    () => db.select({ value: count() }).from(tickets).where(ne(tickets.state, 'CLOSED')),
  ], 5);

  const [
    userTotal, userActive, userSuspended, userNew30d,
    channelTotal, channelActive, channelPlatforms,
    botTotal, botActive, botPlatforms,
    goldConfigRows, goldEnabled, goldSnap24h,
    postTotal, postScheduled, postPublished30d, targetFailed24h, targetSent24h,
    payVerified30d, payPendingReview, paySum30d, paySumTotal,
    subsActive, subsByPlan,
    aiJobs30d, mediaRows, ticketOpen,
  ] = results as [
    CountRow[], CountRow[], CountRow[], CountRow[],
    CountRow[], CountRow[], PlatformRow[],
    CountRow[], CountRow[], PlatformRow[],
    CountRow[], CountRow[], CountRow[],
    CountRow[], CountRow[], CountRow[], CountRow[], CountRow[],
    CountRow[], CountRow[], SumRow[], SumRow[],
    CountRow[], PlanCountRow[],
    CountRow[], MediaRow[], CountRow[],
  ];

  const platformCounts = (
    rows: Array<{ platform: string; value: number }>
  ): { telegram: number; bale: number; rubika: number } => {
    const out = { telegram: 0, bale: 0, rubika: 0 };
    for (const r of rows) {
      if (r.platform === 'telegram' || r.platform === 'bale' || r.platform === 'rubika') out[r.platform] = num(r.value);
    }
    return out;
  };

  return {
    users: {
      total: num(userTotal[0]?.value),
      active: num(userActive[0]?.value),
      suspended: num(userSuspended[0]?.value),
      new30d: num(userNew30d[0]?.value),
    },
    channels: {
      total: num(channelTotal[0]?.value),
      active: num(channelActive[0]?.value),
      ...platformCounts(channelPlatforms.map((r) => ({ platform: r.platform, value: Number(r.value) }))),
    },
    bots: {
      total: num(botTotal[0]?.value),
      active: num(botActive[0]?.value),
      ...platformCounts(botPlatforms.map((r) => ({ platform: r.platform, value: Number(r.value) }))),
    },
    gold: {
      configs: num(goldConfigRows[0]?.value),
      enabled: num(goldEnabled[0]?.value),
      snapshots24h: num(goldSnap24h[0]?.value),
    },
    posts: {
      total: num(postTotal[0]?.value),
      scheduled: num(postScheduled[0]?.value),
      published30d: num(postPublished30d[0]?.value),
      failed24h: num(targetFailed24h[0]?.value),
    },
    payments: {
      verifiedCount30d: num(payVerified30d[0]?.value),
      verifiedSum30d: num(paySum30d[0]?.sum),
      verifiedSumTotal: num(paySumTotal[0]?.sum),
      pendingReview: num(payPendingReview[0]?.value),
    },
    subscriptions: {
      active: num(subsActive[0]?.value),
      byPlan: subsByPlan.map((r) => ({ planName: r.planName, count: num(r.value) })),
    },
    usage: {
      aiJobs30d: num(aiJobs30d[0]?.value),
      mediaCount: num(mediaRows[0]?.value),
      mediaBytes: num(mediaRows[0]?.bytes),
      ticketsOpen: num(ticketOpen[0]?.value),
      deliveries24h: num(targetSent24h[0]?.value),
      deliveriesFailed24h: num(targetFailed24h[0]?.value),
    },
  };
}

export async function listUsers(
  search: string | undefined,
  page: number,
  pageSize: number
): Promise<{ items: Array<{ id: string; firstName: string; lastName: string; email: string; mobile: string; businessName: string; role: string; status: string; createdAt: Date }>; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const term = search?.trim();
  const like = term ? `%${term.replace(/[%_]/g, '')}%` : null;
  const where = like
    ? or(sql`${users.email} LIKE ${like}`, sql`${users.mobile} LIKE ${like}`, sql`${users.businessName} LIKE ${like}`, sql`${users.firstName} LIKE ${like}`, sql`${users.lastName} LIKE ${like}`)
    : undefined;

  const [totalRow] = await db.select({ value: count() }).from(users).where(where);
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      mobile: users.mobile,
      businessName: users.businessName,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(size)
    .offset((p - 1) * size);
  return { items: rows, total: Number(totalRow?.value ?? 0), page: p, pageSize: size };
}

export type AdminPlatform = 'telegram' | 'bale' | 'rubika';

export async function listChannels(
  search: string | undefined,
  platform: AdminPlatform | undefined,
  page: number,
  pageSize: number
): Promise<{
  items: Array<{ id: string; platform: string; channelRef: string; title: string; status: string; createdAt: Date; ownerEmail: string | null; ownerName: string }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const term = search?.trim();
  const like = term ? `%${term.replace(/[%_]/g, '')}%` : null;
  const where = and(
    platform ? eq(channels.platform, platform) : undefined,
    like
      ? or(sql`${channels.title} LIKE ${like}`, sql`${channels.channelRef} LIKE ${like}`, sql`${users.email} LIKE ${like}`)
      : undefined
  );

  const ownerName = sql<string>`COALESCE(CONCAT_WS(' ', ${users.firstName}, ${users.lastName}), '')`;
  const [totalRow] = await db
    .select({ value: count() })
    .from(channels)
    .leftJoin(users, eq(users.id, channels.tenantId))
    .where(where);
  const rows = await db
    .select({
      id: channels.id,
      platform: channels.platform,
      channelRef: channels.channelRef,
      title: channels.title,
      status: channels.status,
      createdAt: channels.createdAt,
      ownerEmail: users.email,
      ownerName,
    })
    .from(channels)
    .leftJoin(users, eq(users.id, channels.tenantId))
    .where(where)
    .orderBy(desc(channels.createdAt))
    .limit(size)
    .offset((p - 1) * size);
  return { items: rows, total: Number(totalRow?.value ?? 0), page: p, pageSize: size };
}

export async function listBots(
  search: string | undefined,
  platform: AdminPlatform | undefined,
  page: number,
  pageSize: number
): Promise<{
  items: Array<{ id: string; platform: string; username: string | null; title: string; status: string; mode: string; aiEnabled: boolean; createdAt: Date; ownerEmail: string | null }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const term = search?.trim();
  const like = term ? `%${term.replace(/[%_]/g, '')}%` : null;
  const where = and(
    platform ? eq(bots.platform, platform) : undefined,
    like
      ? or(sql`${bots.title} LIKE ${like}`, sql`${bots.username} LIKE ${like}`, sql`${users.email} LIKE ${like}`)
      : undefined
  );

  const [totalRow] = await db
    .select({ value: count() })
    .from(bots)
    .leftJoin(users, eq(users.id, bots.tenantId))
    .where(where);
  // NOTE: tokens (token_encrypted/token_masked) are never selected here.
  const rows = await db
    .select({
      id: bots.id,
      platform: bots.platform,
      username: bots.username,
      title: bots.title,
      status: bots.status,
      mode: bots.mode,
      aiEnabled: bots.aiEnabled,
      createdAt: bots.createdAt,
      ownerEmail: users.email,
    })
    .from(bots)
    .leftJoin(users, eq(users.id, bots.tenantId))
    .where(where)
    .orderBy(desc(bots.createdAt))
    .limit(size)
    .offset((p - 1) * size);
  return {
    items: rows.map((r) => ({ ...r, aiEnabled: Number(r.aiEnabled) === 1 })),
    total: Number(totalRow?.value ?? 0),
    page: p,
    pageSize: size,
  };
}

export async function setUserSuspended(
  actorId: string,
  targetId: string,
  suspended: boolean
): Promise<void> {
  if (actorId === targetId) {
    throw new AppError(ERR.VALIDATION('نمی‌توانید حساب خودتان را تغییر وضعیت دهید.'));
  }
  const db = getDb();
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) throw new AppError(ERR.NOT_FOUND('کاربر'));

  await db.update(users).set({ status: suspended ? 'SUSPENDED' : 'ACTIVE' }).where(eq(users.id, targetId));
  if (suspended) await revokeAllUserSessions(targetId).catch(() => undefined);
}

export async function grantSubscription(tenantId: string, planCode: string, months: number): Promise<{ subscriptionId: string }> {
  const db = getDb();
  const [plan] = await db.select().from(plans).where(and(eq(plans.code, planCode), eq(plans.isActive, 1))).limit(1);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));
  const result = await activateSubscription(tenantId, plan.id, months);
  return { subscriptionId: result.subscriptionId };
}

const PAYMENT_STATES = [
  'CREATED', 'REDIRECTED', 'VERIFIED', 'FAILED', 'CANCELLED', 'REFUNDED',
  'PENDING_REVIEW', 'REJECTED', 'COMPLETED',
] as const;
type PayState = (typeof PAYMENT_STATES)[number];

/** Current state of a payment (for audit meta); null when missing. */
export async function getPaymentState(paymentId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db.select({ state: payments.state }).from(payments).where(eq(payments.id, paymentId)).limit(1);
  return row?.state ?? null;
}

export async function listAdminPayments(
  state: string | undefined,
  page: number,
  pageSize: number
): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const where =
    state && (PAYMENT_STATES as readonly string[]).includes(state)
      ? eq(payments.state, state as PayState)
      : undefined;

  const [totalRow] = await db.select({ value: count() }).from(payments).where(where);
  const rows = await db
    .select({
      id: payments.id,
      tenantId: payments.tenantId,
      purpose: payments.purpose,
      planId: payments.planId,
      months: payments.months,
      amountRial: payments.amountRial,
      gateway: payments.gateway,
      gatewayRef: payments.gatewayRef,
      reference: payments.reference,
      state: payments.state,
      verifiedAt: payments.verifiedAt,
      receiptMediaId: payments.receiptMediaId,
      receiptNote: payments.receiptNote,
      reviewedBy: payments.reviewedBy,
      reviewedAt: payments.reviewedAt,
      createdAt: payments.createdAt,
      // user (payer) summary
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
      userMobile: users.mobile,
      // plan summary
      planCode: plans.code,
      planNameFa: plans.nameFa,
    })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.tenantId))
    .leftJoin(plans, eq(plans.id, payments.planId))
    .where(where)
    .orderBy(desc(payments.createdAt))
    .limit(size)
    .offset((p - 1) * size);

  return {
    items: rows.map((r) => ({ ...r, amountRial: Number(r.amountRial) })),
    total: Number(totalRow?.value ?? 0),
    page: p,
    pageSize: size,
  };
}

/**
 * Admin review of payments (contract 14-contract item 5).
 *
 * Two flavours share one settlement service:
 *  - PENDING_REVIEW (card-to-card receipt) → state COMPLETED + reviewed_by/at.
 *  - Online fallback (§117 manual verify: CREATED/REDIRECTED/FAILED) → state
 *    VERIFIED, exactly like before.
 *
 * Idempotency: approving an already-settled payment (VERIFIED/COMPLETED) is a
 * NO-OP SUCCESS (chosen over 409 so a double-click or retry never errors).
 * All financial side effects (subscription activation / wallet credit /
 * referral first-purchase hook) run in ONE transaction, mirroring the online
 * verify path.
 */
export async function approvePayment(
  actorId: string,
  paymentId: string,
  note?: string
): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw new AppError(ERR.NOT_FOUND('پرداخت'));

  if (payment.state === 'VERIFIED' || payment.state === 'COMPLETED') {
    return { ok: true, message: 'این پرداخت پیش‌تر تأیید شده است.' };
  }
  if (payment.state === 'REJECTED' || payment.state === 'REFUNDED' || payment.state === 'CANCELLED') {
    throw new AppError(ERR.CONFLICT('این پرداخت قابل تأیید نیست.'));
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    // Re-read under lock: concurrent approvals must not double-settle.
    const [locked] = await tx.select().from(payments).where(eq(payments.id, payment.id)).limit(1).for('update');
    if (!locked) throw new AppError(ERR.NOT_FOUND('پرداخت'));
    if (locked.state === 'VERIFIED' || locked.state === 'COMPLETED') return; // settled concurrently → no-op
    if (locked.state === 'REJECTED' || locked.state === 'REFUNDED' || locked.state === 'CANCELLED') {
      throw new AppError(ERR.CONFLICT('این پرداخت قابل تأیید نیست.'));
    }

    const lockedTarget: PayState = locked.state === 'PENDING_REVIEW' ? 'COMPLETED' : 'VERIFIED';
    const metaJson: Record<string, unknown> = { ...(locked.metaJson ?? {}) };
    if (note && note.trim() !== '') metaJson.reviewNote = note.trim().slice(0, 500);

    await tx
      .update(payments)
      .set({
        state: lockedTarget,
        verifiedAt: now,
        reviewedBy: actorId,
        reviewedAt: now,
        metaJson,
      })
      .where(and(eq(payments.id, locked.id), eq(payments.state, locked.state)));

    if (locked.purpose === 'SUBSCRIPTION' && locked.planId) {
      await activateSubscriptionTx(tx, locked.tenantId, locked.planId, locked.months);
      await referralHookFirstPurchase(locked.tenantId, Number(locked.amountRial), tx);
    } else if (locked.purpose === 'WALLET_TOPUP') {
      await moveMoneyTx(tx, locked.tenantId, 'CREDIT', Number(locked.amountRial), { type: 'payment', id: locked.id }, 'شارژ کیف پول (تأیید دستی)');
    }
  });

  await emitPaymentCompleted(payment, actorId);
  return { ok: true, message: 'پرداخت با موفقیت تأیید و اعمال شد.' };
}

async function emitPaymentCompleted(
  payment: typeof payments.$inferSelect,
  actorId: string
): Promise<void> {
  await notifyTenant({
    tenantId: payment.tenantId,
    kind: 'PAYMENT_APPROVED',
    titleFa: 'پرداخت شما تأیید شد',
    bodyFa:
      payment.purpose === 'SUBSCRIPTION'
        ? 'رسید پرداخت شما تأیید شد و اشتراک شما فعال/تمدید گردید.'
        : 'پرداخت شما تأیید و کیف پول شما شارژ شد.',
  }).catch(() => undefined);
  void actorId;
}

/**
 * Rejects a PENDING_REVIEW card-to-card payment. Idempotent: rejecting an
 * already-REJECTED payment is a no-op success; other non-reviewable states
 * raise a stable CONFLICT.
 */
export async function rejectPayment(
  actorId: string,
  paymentId: string,
  reason: string
): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw new AppError(ERR.NOT_FOUND('پرداخت'));
  if (payment.state === 'REJECTED') {
    return { ok: true, message: 'این پرداخت پیش‌تر رد شده است.' };
  }
  if (payment.state !== 'PENDING_REVIEW') {
    throw new AppError(ERR.CONFLICT('فقط پرداخت‌های در انتظار بررسی قابل رد هستند.'));
  }

  const metaJson: Record<string, unknown> = { ...(payment.metaJson ?? {}), rejectReason: reason.trim().slice(0, 500) };
  const now = new Date();
  const res = await db
    .update(payments)
    .set({ state: 'REJECTED', reviewedBy: actorId, reviewedAt: now, metaJson })
    .where(and(eq(payments.id, payment.id), eq(payments.state, 'PENDING_REVIEW')));
  const changed = Array.isArray(res) ? Number(res[0]?.affectedRows ?? 0) : Number((res as { affectedRows?: number })?.affectedRows ?? 0);
  if (changed === 0) {
    // Lost a race with approve/another reject — report the current truth.
    const [fresh] = await db.select({ state: payments.state }).from(payments).where(eq(payments.id, payment.id)).limit(1);
    if (fresh?.state === 'REJECTED') return { ok: true, message: 'این پرداخت پیش‌تر رد شده است.' };
    throw new AppError(ERR.CONFLICT('این پرداخت دیگر قابل رد نیست.'));
  }

  await notifyTenant({
    tenantId: payment.tenantId,
    kind: 'PAYMENT_REJECTED',
    titleFa: 'رسید پرداخت شما تأیید نشد',
    bodyFa: `رسید پرداخت شما تأیید نشد. دلیل: ${reason.trim().slice(0, 200)}`,
  }).catch(() => undefined);

  return { ok: true, message: 'پرداخت رد شد.' };
}

export async function listAuditLogs(
  action: string | undefined,
  page: number,
  pageSize: number
): Promise<{ items: Array<{ id: string; actorId: string | null; actorRole: string | null; action: string; subjectType: string | null; subjectId: string | null; createdAt: Date }>; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const where = action?.trim() ? eq(auditLogs.action, action.trim()) : undefined;
  const [totalRow] = await db.select({ value: count() }).from(auditLogs).where(where);
  const rows = await db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actorRole: auditLogs.actorRole,
      action: auditLogs.action,
      subjectType: auditLogs.subjectType,
      subjectId: auditLogs.subjectId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(size)
    .offset((p - 1) * size);
  return { items: rows, total: Number(totalRow?.value ?? 0), page: p, pageSize: size };
}

export async function listPlans(): Promise<Array<Record<string, unknown>>> {
  const db = getDb();
  const rows = await db.select().from(plans).orderBy(plans.sortOrder);
  return rows.map((r) => ({ ...r, priceRial: Number(r.priceRial) }));
}

export interface PlanPatch {
  nameFa?: string;
  priceRial?: number;
  periodDays?: number;
  isActive?: boolean;
  limitsJson?: Record<string, unknown>;
  featuresJson?: Record<string, unknown>;
}

const PLAN_LIMIT_KEYS = ['max_channels', 'max_posts', 'max_bots', 'max_schedules', 'ai_monthly', 'storage_mb'] as const;

const DEFAULT_PLAN_LIMITS: PlanLimits = {
  max_channels: 1,
  max_posts: 30,
  max_bots: 1,
  max_schedules: 10,
  ai_monthly: 50,
  storage_mb: 512,
};

const DEFAULT_PLAN_FEATURES: PlanFeatures = {
  gold_ticker: false,
  auto_responder: false,
  woocommerce: false,
  api_access: false,
};

function numericLimit(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.entries(record).every(([k, v]) => keys.includes(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

export async function createPlan(input: {
  code: string;
  nameFa: string;
  priceRial: number;
  periodDays: number;
  limitsJson?: Record<string, unknown>;
  featuresJson?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const db = getDb();
  const code = input.code.trim();
  const [existing] = await db.select({ id: plans.id }).from(plans).where(eq(plans.code, code)).limit(1);
  if (existing) throw new AppError(ERR.VALIDATION('کد پلن تکراری است.'));

  const limits = { ...DEFAULT_PLAN_LIMITS, ...(input.limitsJson ?? {}) };
  if (!numericLimit(limits, PLAN_LIMIT_KEYS)) {
    throw new AppError(ERR.VALIDATION('قالب محدودیت‌های پلن معتبر نیست.'));
  }
  const features = { ...DEFAULT_PLAN_FEATURES, ...(input.featuresJson ?? {}) };
  if (!Object.values(features).every((v) => typeof v === 'boolean')) {
    throw new AppError(ERR.VALIDATION('قالب امکانات پلن معتبر نیست.'));
  }

  const id = newId();
  await db.insert(plans).values({
    id,
    code,
    nameFa: input.nameFa.trim().slice(0, 80),
    priceRial: Math.max(0, Math.floor(input.priceRial)),
    periodDays: Math.min(3650, Math.max(1, Math.floor(input.periodDays))),
    limitsJson: limits,
    featuresJson: features,
    sortOrder: 0,
    isActive: 1,
  });
  return { id };
}

export async function deletePlan(planId: string): Promise<void> {
  const db = getDb();
  const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));
  // Any subscription row (ACTIVE, EXPIRED or CANCELLED) keeps the plan alive —
  // history must stay resolvable; deactivate the plan instead of deleting it.
  const [refRow] = await db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.planId, planId));
  if (Number(refRow?.value ?? 0) > 0) {
    throw new AppError(ERR.VALIDATION('به این پلن اشتراک فعال متصل است؛ ابتدا آن اشتراک‌ها را بررسی کنید یا پلن را غیرفعال کنید.'));
  }
  await db.delete(plans).where(eq(plans.id, planId));
}

export async function updatePlan(planId: string, patch: PlanPatch): Promise<void> {
  const db = getDb();
  const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));
  const update: Partial<{
    nameFa: string;
    priceRial: number;
    periodDays: number;
    isActive: number;
    limitsJson: PlanLimits;
    featuresJson: PlanFeatures;
  }> = {};
  if (patch.nameFa !== undefined) update.nameFa = patch.nameFa.trim().slice(0, 80);
  if (patch.priceRial !== undefined) update.priceRial = Math.max(0, Math.floor(patch.priceRial));
  if (patch.periodDays !== undefined) update.periodDays = Math.min(3650, Math.max(1, Math.floor(patch.periodDays)));
  if (patch.isActive !== undefined) update.isActive = patch.isActive ? 1 : 0;
  if (patch.limitsJson !== undefined) {
    if (!numericLimit(patch.limitsJson, PLAN_LIMIT_KEYS)) {
      throw new AppError(ERR.VALIDATION('قالب محدودیت‌های پلن معتبر نیست.'));
    }
    update.limitsJson = patch.limitsJson as unknown as PlanLimits;
  }
  if (patch.featuresJson !== undefined) {
    if (!Object.entries(patch.featuresJson).every(([, v]) => typeof v === 'boolean')) {
      throw new AppError(ERR.VALIDATION('قالب امکانات پلن معتبر نیست.'));
    }
    update.featuresJson = patch.featuresJson as unknown as PlanFeatures;
  }
  if (Object.keys(update).length === 0) return;
  await db.update(plans).set(update).where(eq(plans.id, planId));
}

const MAX_SETTINGS_KEYS = 100;

export async function getSettings(): Promise<Record<string, unknown>> {
  const db = getDb();
  const rows = await db.select().from(systemSettings);
  const map: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.settingKey.startsWith('notif_pref:')) continue; // per-tenant data stays hidden
    if (r.settingKey === 'cardToCardCards') continue; // re-added below in coerced API shape
    map[r.settingKey] = r.valueJson;
  }
  // Payment gateway settings always surface in their contract shape
  // (contract 14-contract item 2), even if the 0003 seed rows are missing.
  const ps = await getPaymentSettings();
  map.paymentOnlineEnabled = ps.onlineEnabled;
  map.paymentCardToCardEnabled = ps.cardToCardEnabled;
  map.paymentProvider = ps.provider;
  map.cardToCardCards = ps.cards;
  return map;
}

export async function putSettings(map: Record<string, unknown>): Promise<number> {
  const db = getDb();
  const entries = Object.entries(map).filter(([k]) => k.length > 0 && k.length <= 80 && !k.startsWith('notif_pref:'));
  if (entries.length > MAX_SETTINGS_KEYS) {
    throw new AppError(ERR.VALIDATION('تعداد کلیدهای تنظیمات بیش از حد مجاز است.'));
  }
  for (const [key, value] of entries) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new AppError(ERR.VALIDATION(`مقدار کلید «${key}» باید یک شیء JSON باشد.`));
    }
    await db
      .insert(systemSettings)
      .values({ settingKey: key, valueJson: value as Record<string, unknown> })
      .onDuplicateKeyUpdate({ set: { valueJson: value as Record<string, unknown> } });
  }
  return entries.length;
}

const BROADCAST_BATCH = 500;
const BROADCAST_MAX_BATCHES = 1000; // hard bound: 500k users

/** Broadcast (§27): notify ALL ACTIVE users in bounded batches of 500. */
export async function broadcast(actorId: string, titleFa: string, bodyFa: string): Promise<number> {
  const db = getDb();
  let notified = 0;
  let cursor = '';
  for (let batch = 0; batch < BROADCAST_MAX_BATCHES; batch++) {
    const rows = cursor
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.status, 'ACTIVE'), sql`${users.id} > ${cursor}`))
          .orderBy(users.id)
          .limit(BROADCAST_BATCH)
      : await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.status, 'ACTIVE'))
          .orderBy(users.id)
          .limit(BROADCAST_BATCH);
    if (rows.length === 0) break;
    for (const r of rows) {
      await notifyTenant({ tenantId: r.id, kind: 'BROADCAST', titleFa, bodyFa });
      notified++;
    }
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = last.id;
    if (rows.length < BROADCAST_BATCH) break;
  }
  void actorId;
  return notified;
}

export async function releaseChannel(actorId: string, platform: 'telegram' | 'bale' | 'rubika', channelRef: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ tenantId: channelRegistry.tenantId })
    .from(channelRegistry)
    .where(and(eq(channelRegistry.platform, platform), eq(channelRegistry.channelRef, channelRef)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کانال در دفتر ثبت کانال‌ها'));
  await db
    .update(channelRegistry)
    .set({ tenantId: null, releasedAt: new Date() })
    .where(and(eq(channelRegistry.platform, platform), eq(channelRegistry.channelRef, channelRef)));
  void actorId;
}
