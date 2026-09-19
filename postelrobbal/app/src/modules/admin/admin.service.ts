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

export async function listAdminPayments(
  state: string | undefined,
  page: number,
  pageSize: number
): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const validStates = ['CREATED', 'REDIRECTED', 'VERIFIED', 'FAILED', 'CANCELLED', 'REFUNDED'] as const;
  type PayState = (typeof validStates)[number];
  const where = state && (validStates as readonly string[]).includes(state) ? eq(payments.state, state as PayState) : undefined;

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
      state: payments.state,
      verifiedAt: payments.verifiedAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
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
 * Manual verification path (§117 fallback): admin confirms a payment that the
 * gateway flow failed to settle. Applies the same side effects as the
 * automated callback, idempotently for wallet credits.
 */
export async function approvePayment(actorId: string, paymentId: string): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw new AppError(ERR.NOT_FOUND('پرداخت'));
  if (payment.state === 'VERIFIED') {
    return { ok: true, message: 'این پرداخت پیش‌تر تأیید شده است.' };
  }
  if (payment.state === 'REFUNDED' || payment.state === 'CANCELLED') {
    throw new AppError(ERR.VALIDATION('این پرداخت قابل تأیید دستی نیست.'));
  }

  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({ state: 'VERIFIED', verifiedAt: new Date() })
      .where(and(eq(payments.id, payment.id), eq(payments.state, payment.state)));

    if (payment.purpose === 'SUBSCRIPTION' && payment.planId) {
      await activateSubscriptionTx(tx, payment.tenantId, payment.planId, payment.months);
    } else if (payment.purpose === 'WALLET_TOPUP') {
      await moveMoneyTx(tx, payment.tenantId, 'CREDIT', Number(payment.amountRial), { type: 'payment', id: payment.id }, 'شارژ کیف پول (تأیید دستی)');
    }
  });

  return { ok: true, message: 'پرداخت با موفقیت تأیید و اعمال شد.' };
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
    map[r.settingKey] = r.valueJson;
  }
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
