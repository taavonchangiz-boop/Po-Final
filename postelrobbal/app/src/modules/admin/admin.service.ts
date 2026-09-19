import { and, count, desc, eq, gte, or, sql } from 'drizzle-orm';
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
} from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import type { PlanLimits, PlanFeatures } from '../../db/schema.js';
import { notifyTenant } from '../notifications/delivery.js';
import { activateSubscription, activateSubscriptionTx } from '../subscriptions/plan.service.js';
import { moveMoneyTx } from '../wallet/wallet.service.js';
import { revokeAllUserSessions } from '../../security/sessions.js';
import { referralHookFirstPurchase } from '../payments/payment.service.js';
import { getPaymentSettings } from '../payments/payment-settings.service.js';

export async function getOverview(): Promise<{
  users: number;
  activeSubscriptions: number;
  paymentsVerifiedSum30d: number;
  deliveriesFailed24h: number;
  scheduledPosts: number;
}> {
  const db = getDb();
  const [userRow] = await db.select({ value: count() }).from(users);
  const [subRow] = await db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.state, 'ACTIVE'));

  const since30d = new Date(Date.now() - 30 * 86400_000);
  const [payRow] = await db
    .select({ sum: sql<string | number | null>`COALESCE(SUM(${payments.amountRial}), 0)` })
    .from(payments)
    .where(and(eq(payments.state, 'VERIFIED'), gte(payments.verifiedAt, since30d)));

  const since24h = new Date(Date.now() - 24 * 3600_000);
  const [failRow] = await db
    .select({ value: count() })
    .from(postTargets)
    .where(and(eq(postTargets.state, 'FAILED'), gte(postTargets.updatedAt, since24h)));

  const [schedRow] = await db.select({ value: count() }).from(posts).where(eq(posts.state, 'SCHEDULED'));

  return {
    users: Number(userRow?.value ?? 0),
    activeSubscriptions: Number(subRow?.value ?? 0),
    paymentsVerifiedSum30d: Number(payRow?.sum ?? 0),
    deliveriesFailed24h: Number(failRow?.value ?? 0),
    scheduledPosts: Number(schedRow?.value ?? 0),
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
  limitsJson?: Record<string, unknown>;
  featuresJson?: Record<string, unknown>;
}

function numericLimit(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.entries(record).every(([k, v]) => keys.includes(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

export async function updatePlan(planId: string, patch: PlanPatch): Promise<void> {
  const db = getDb();
  const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));
  const update: Partial<{ nameFa: string; priceRial: number; limitsJson: PlanLimits; featuresJson: PlanFeatures }> = {};
  if (patch.nameFa !== undefined) update.nameFa = patch.nameFa.trim().slice(0, 80);
  if (patch.priceRial !== undefined) update.priceRial = Math.max(0, Math.floor(patch.priceRial));
  if (patch.limitsJson !== undefined) {
    if (!numericLimit(patch.limitsJson, ['max_channels', 'max_posts', 'max_bots', 'max_schedules', 'ai_monthly', 'storage_mb'])) {
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
