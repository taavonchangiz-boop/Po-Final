/**
 * Subscription service: current plan resolution, plan limits for other modules,
 * plan change (payment-backed) and transactional activation on verified payments.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { planLimit, notFound, conflict } from '../../core/errors.js';
import { AnalyticsService } from '../../core/events.js';
import { faJalaliDateLong } from '../../core/jalali.js';
import { db, withTransaction, type DbExecutor, type Tx } from '../../db/client.js';
import { plans, subscriptions, payments } from '../../db/schema.js';
import { enqueueOutbox } from '../../core/outbox.js';
import { createNotification } from '../notifications/notifications.service.js';

export type PlanLimits = {
  channels: number;
  postsPerMonth: number;
  aiCredits: number;
  bots: number;
  schedules: number;
  storageMb: number;
};

export type PlanRow = typeof plans.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;

export const PlanLimitsSchema = z.object({
  channels: z.number().int().min(0),
  postsPerMonth: z.number().int().min(0),
  aiCredits: z.number().int().min(0),
  bots: z.number().int().min(0),
  schedules: z.number().int().min(0),
  storageMb: z.number().int().min(0),
});

/** Conservative defaults used only if the FREE plan row is missing (seed not run). */
const FALLBACK_FREE_LIMITS: PlanLimits = {
  channels: 2,
  postsPerMonth: 30,
  aiCredits: 20,
  bots: 1,
  schedules: 5,
  storageMb: 200,
};

function planRowToLimits(plan: Pick<PlanRow, 'limits'>): PlanLimits {
  return PlanLimitsSchema.parse(plan.limits);
}

function syntheticFreePlan(): PlanRow {
  return {
    id: 0,
    code: 'FREE',
    name: 'رایگان',
    description: null,
    priceMonthly: 0,
    limits: FALLBACK_FREE_LIMITS,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(),
  };
}

export const SubscriptionService = {
  /** Active subscription + its plan (or null when the tenant has none). */
  async getActiveSubscription(userId: number): Promise<{ subscription: SubscriptionRow; plan: PlanRow } | null> {
    const rows = await db
      .select({ subscription: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'ACTIVE')))
      .orderBy(desc(subscriptions.id))
      .limit(1);
    return rows[0] ?? null;
  },

  async getPlanById(planId: number): Promise<PlanRow | null> {
    const rows = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    return rows[0] ?? null;
  },

  async listActivePlans(): Promise<PlanRow[]> {
    return db.select().from(plans).where(eq(plans.isActive, true)).orderBy(plans.sortOrder, plans.id);
  },

  /** FREE plan row (seeded); null when seed has not run. */
  async getFreePlan(): Promise<PlanRow | null> {
    const rows = await db.select().from(plans).where(eq(plans.code, 'FREE')).limit(1);
    return rows[0] ?? null;
  },

  /**
   * Effective plan for a tenant: ACTIVE subscription plan, else FREE.
   * Other modules (bots/ai/media) call this for limit enforcement.
   */
  async resolvePlanForUser(userId: number): Promise<PlanRow> {
    const active = await SubscriptionService.getActiveSubscription(userId);
    if (active) return active.plan;
    const free = await SubscriptionService.getFreePlan();
    if (free) return free;
    // Honest fallback: behave like FREE without pretending a paid plan exists.
    return syntheticFreePlan();
  },

  async getLimitsForUser(userId: number): Promise<PlanLimits> {
    return planRowToLimits(await SubscriptionService.resolvePlanForUser(userId));
  },

  /** Overview for GET /subscription (current ACTIVE/EXPIRED + plan + limits). */
  async getOverview(userId: number): Promise<{
    subscription: SubscriptionRow | null;
    plan: PlanRow;
    limits: PlanLimits;
  }> {
    const active = await SubscriptionService.getActiveSubscription(userId);
    if (active) {
      return { subscription: active.subscription, plan: active.plan, limits: planRowToLimits(active.plan) };
    }
    const latest = await db
      .select({ subscription: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.id))
      .limit(1);
    if (latest[0]) {
      return {
        subscription: latest[0].subscription,
        plan: latest[0].plan,
        limits: planRowToLimits(latest[0].plan),
      };
    }
    const free = await SubscriptionService.resolvePlanForUser(userId);
    return { subscription: null, plan: free, limits: planRowToLimits(free) };
  },

  /**
   * Change plan: creates a SUBSCRIPTION payment and returns the gateway redirect.
   * A zero-price plan (FREE) is applied immediately without payment.
   */
  async changePlan(
    userId: number,
    planId: number,
  ): Promise<{ paymentId: number | null; redirectUrl: string | null; applied: boolean }> {
    const plan = await SubscriptionService.getPlanById(planId);
    if (plan === null || !plan.isActive) throw notFound('پلن مورد نظر یافت نشد.');

    const active = await SubscriptionService.getActiveSubscription(userId);
    if (active && active.plan.id === plan.id && active.subscription.expiresAt.getTime() > Date.now()) {
      throw conflict('شما در حال حاضر همین پلن را دارید.');
    }

    if (plan.priceMonthly <= 0) {
      await withTransaction(async (tx) => {
        await SubscriptionService.activatePlan(tx, userId, plan.id, 1, null);
        await SubscriptionService.notifySubscriptionActivated(tx, userId, plan, new Date());
      });
      return { paymentId: null, redirectUrl: null, applied: true };
    }

    const { PaymentService } = await import('./payment.service.js');
    const result = await PaymentService.createPayment(userId, { purpose: 'SUBSCRIPTION', planId: plan.id });
    return { paymentId: result.paymentId, redirectUrl: result.redirectUrl, applied: false };
  },

  /**
   * Close old ACTIVE subscriptions and create a fresh one.
   * Renewal extends from the current expiry when still active (no lost days).
   * Must run inside a transaction.
   */
  async activatePlan(tx: Tx, userId: number, planId: number, months: number, paymentId: number | null): Promise<SubscriptionRow> {
    const now = new Date();
    const existing = await tx
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'ACTIVE')))
      .orderBy(desc(subscriptions.id));
    const wasActive = existing.length > 0;
    const base = existing.reduce<Date>((acc, row) => (row.expiresAt.getTime() > acc.getTime() ? row.expiresAt : acc), now);

    if (existing.length > 0) {
      await tx
        .update(subscriptions)
        .set({ status: 'EXPIRED', updatedAt: now })
        .where(
          and(
            eq(subscriptions.userId, userId),
            eq(subscriptions.status, 'ACTIVE'),
            inArray(
              subscriptions.id,
              existing.map((row) => row.id),
            ),
          ),
        );
    }

    const expiresAt = new Date(base);
    expiresAt.setMonth(expiresAt.getMonth() + Math.max(1, months));

    const inserted = await tx
      .insert(subscriptions)
      .values({ userId, planId, status: 'ACTIVE', startedAt: now, expiresAt, paymentId })
      .$returningId();
    const newId = inserted[0]?.id;
    if (newId === undefined) throw new Error('subscription_insert_failed');

    AnalyticsService.trackEvent({
      userId,
      type: wasActive ? 'subscription.renewed' : 'subscription.created',
      subjectType: 'subscription',
      subjectId: Number(newId),
      data: { planId, months, paymentId },
    });

    return {
      id: Number(newId),
      userId,
      planId,
      status: 'ACTIVE',
      startedAt: now,
      expiresAt,
      cancelledAt: null,
      paymentId,
      createdAt: now,
      updatedAt: now,
    };
  },

  /** In-app notification + channel fan-out for an activated subscription. */
  async notifySubscriptionActivated(executor: DbExecutor, userId: number, plan: PlanRow, expiresAt: Date): Promise<void> {
    const title = 'اشتراک شما فعال شد';
    const body = `پلن «${plan.name}» تا تاریخ ${faJalaliDateLong(expiresAt)} فعال است.`;
    const notificationId = await createNotification(executor, {
      userId,
      category: 'SUBSCRIPTION',
      title,
      body,
    });
    await enqueueOutbox(executor, {
      aggregateType: 'notification',
      aggregateId: notificationId,
      eventType: 'notification.fanout',
      payload: { notificationId, userId, text: `${title} — ${body}` },
    });
  },

  /** Sum of VERIFIED payments in a month (UTC) — admin KPIs. */
  async sumVerifiedPaymentsMonth(year: number, monthIndex0: number): Promise<number> {
    const start = new Date(Date.UTC(year, monthIndex0, 1));
    const end = new Date(Date.UTC(year, monthIndex0 + 1, 1));
    const rows = await db
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'VERIFIED'),
          sql`${payments.verifiedAt} >= ${start}`,
          sql`${payments.verifiedAt} < ${end}`,
        ),
      );
    return Number(rows[0]?.total ?? 0);
  },
};

export { planLimit };
