/**
 * Payment service: payment creation against the configured gateway and the
 * idempotent, transactional callback verification (ADR-013, api-contract).
 *
 * Verification flow (GET /payments/callback/:gateway):
 *   1. locate payment (payment_id or authority),
 *   2. server-to-server gateway.verify (never trust the redirect query alone),
 *   3. withIdempotency(`payment-verify:{id}`) + CAS status flip → effects:
 *      SUBSCRIPTION → activate plan + notification + fan-out,
 *      WALLET_TOPUP → wallet credit (ledger, idempotent),
 *      referral reward on the referred user's first verified payment.
 */
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { notFound, paymentError, validationError } from '../../core/errors.js';
import { AnalyticsService } from '../../core/events.js';
import { withIdempotency } from '../../core/idempotency.js';
import { db, withTransaction } from '../../db/client.js';
import { payments, plans, subscriptions, users } from '../../db/schema.js';
import { getPaymentGateway, type GatewayName, type GatewayVerifyResult } from './gateway.js';
import { SubscriptionService } from './subscription.service.js';
import { WalletService } from './wallet.service.js';
import { ReferralService } from './referral.service.js';

export type PaymentRow = typeof payments.$inferSelect;

export const GATEWAYS: readonly GatewayName[] = ['ZARINPAL', 'IDPAY', 'ZIBAL', 'MOCK'];

const WALLET_TOPUP_PRESETS = [100_000, 500_000, 1_000_000, 2_000_000, 5_000_000];
const WALLET_TOPUP_MIN = 100_000; // Rial
const WALLET_TOPUP_MAX = 500_000_000; // Rial — hard cap per transaction

export function parseGatewayName(raw: string): GatewayName {
  const upper = raw.trim().toUpperCase();
  if (!(GATEWAYS as readonly string[]).includes(upper)) {
    throw validationError('درگاه پرداخت نامعتبر است.');
  }
  return upper as GatewayName;
}

function requireConfiguredGateway(): GatewayName {
  const provider = env.PAYMENT_PROVIDER;
  if (!provider) {
    throw paymentError('درگاه پرداخت پیکربندی نشده است. با مدیر سیستم تماس بگیرید.');
  }
  return provider;
}

export const PaymentService = {
  walletTopupPresets(): number[] {
    return [...WALLET_TOPUP_PRESETS];
  },

  /** Create a payment row and start the gateway session. */
  async createPayment(
    userId: number,
    input: { purpose: 'SUBSCRIPTION' | 'WALLET_TOPUP'; planId?: number; amount?: number },
  ): Promise<{ paymentId: number; redirectUrl: string; amount: number; gateway: GatewayName }> {
    const gatewayName = requireConfiguredGateway();
    const gateway = getPaymentGateway(gatewayName);

    let amount: number;
    let planId: number | null = null;
    let description: string;

    if (input.purpose === 'SUBSCRIPTION') {
      if (input.planId === undefined) throw validationError('پلن برای تغییر اشتراک الزامی است.');
      const plan = await SubscriptionService.getPlanById(input.planId);
      if (plan === null || !plan.isActive) throw notFound('پلن مورد نظر یافت نشد.');
      amount = plan.priceMonthly;
      planId = plan.id;
      description = `تمدید اشتراک پستیار — پلن ${plan.name}`;
      if (amount <= 0) throw paymentError('این پلن نیازی به پرداخت ندارد.');
    } else {
      amount = input.amount ?? 0;
      if (!Number.isInteger(amount) || amount < WALLET_TOPUP_MIN) {
        throw validationError(`حداقل مبلغ شارژ کیف پول ${WALLET_TOPUP_MIN.toLocaleString('fa-IR')} ریال است.`);
      }
      if (amount > WALLET_TOPUP_MAX) {
        throw validationError('مبلغ واردشده بیش از حد مجاز است.');
      }
      description = 'شارژ کیف پول پستیار';
    }

    // Insert first so the callback URL can bind the payment id.
    const inserted = await db
      .insert(payments)
      .values({
        userId,
        purpose: input.purpose,
        planId,
        amount,
        gateway: gatewayName,
        status: 'CREATED',
      })
      .$returningId();
    const paymentId = inserted[0]?.id;
    if (paymentId === undefined) throw new Error('payment_insert_failed');
    const id = Number(paymentId);

    const callbackUrl = `${env.API_URL}/api/v1/payments/callback/${gatewayName.toLowerCase()}?payment_id=${id}`;

    try {
      const created = await gateway.createPayment(amount, callbackUrl, description);
      await db
        .update(payments)
        .set({ authority: created.authority, status: 'REDIRECTED', updatedAt: new Date() })
        .where(and(eq(payments.id, id), eq(payments.status, 'CREATED')));
      AnalyticsService.trackEvent({
        userId,
        type: 'payment.created',
        subjectType: 'payment',
        subjectId: id,
        data: { purpose: input.purpose, gateway: gatewayName, amount },
      });
      return { paymentId: id, redirectUrl: created.redirectUrl, amount, gateway: gatewayName };
    } catch (err) {
      await db
        .update(payments)
        .set({ status: 'FAILED', meta: { error: 'gateway_create_failed' }, updatedAt: new Date() })
        .where(eq(payments.id, id));
      throw err;
    }
  },

  async listForUser(userId: number, page: number, limit: number): Promise<{ items: PaymentRow[]; total: number }> {
    const [items, totalRows] = await Promise.all([
      db
        .select()
        .from(payments)
        .where(eq(payments.userId, userId))
        .orderBy(desc(payments.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(payments).where(eq(payments.userId, userId)),
    ]);
    return { items, total: Number(totalRows[0]?.value ?? 0) };
  },

  /** Map a gateway callback query to the payment row (never leaks existence). */
  async locateCallbackPayment(
    gateway: GatewayName,
    query: Record<string, unknown>,
  ): Promise<PaymentRow> {
    const paymentId = Number(query['payment_id']);
    const authority =
      typeof query['Authority'] === 'string' ? query['Authority'] :
      typeof query['authority'] === 'string' ? query['authority'] :
      typeof query['id'] === 'string' ? query['id'] :
      typeof query['track_id'] === 'string' ? query['track_id'] : null;

    let row: PaymentRow | null = null;
    if (Number.isInteger(paymentId) && paymentId > 0) {
      const rows = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      row = rows[0] ?? null;
    }
    if (row === null && authority !== null && authority.length > 0) {
      const rows = await db.select().from(payments).where(eq(payments.authority, authority)).limit(1);
      row = rows[0] ?? null;
    }
    if (row === null || row.gateway !== gateway) {
      // Same generic answer for "not found" and "wrong gateway": no existence leak.
      throw notFound('پرداخت یافت نشد.');
    }
    return row;
  },

  /**
   * Verify a callback server-side and apply effects exactly once.
   * Returns the SPA redirect path.
   */
  async verifyCallback(
    gateway: GatewayName,
    payment: PaymentRow,
    query: Record<string, unknown>,
  ): Promise<{ redirect: string; replayed: boolean; verified: boolean }> {
    const gw = getPaymentGateway(gateway);

    if (payment.status === 'VERIFIED') {
      return { redirect: PaymentService.successRedirect(payment), replayed: true, verified: true };
    }
    if (payment.status === 'FAILED' || payment.status === 'REFUNDED') {
      return { redirect: '/app/wallet?payment=failed', replayed: true, verified: false };
    }

    const authorityOrRef =
      payment.authority ??
      (typeof query['Authority'] === 'string' ? query['Authority'] :
       typeof query['authority'] === 'string' ? query['authority'] : '');

    let verifyResult: GatewayVerifyResult;
    try {
      verifyResult = await gw.verify(authorityOrRef, payment.amount, { orderId: `py-${payment.id}` });
    } catch (err) {
      AnalyticsService.trackEvent({
        userId: payment.userId,
        type: 'payment.failed',
        subjectType: 'payment',
        subjectId: payment.id,
        data: { gateway, reason: 'verify_request_error' },
      });
      await db
        .update(payments)
        .set({ status: 'FAILED', meta: { error: 'verify_unreachable' }, updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), inArray(payments.status, ['CREATED', 'REDIRECTED'])));
      throw paymentError('بررسی پرداخت ناموفق بود. اگر مبلغ کسر شده باشد به‌صورت خودکار بازگشت داده می‌شود.');
    }

    if (!verifyResult.ok) {
      await db
        .update(payments)
        .set({ status: 'FAILED', meta: { gatewayResponse: 'rejected' }, updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), inArray(payments.status, ['CREATED', 'REDIRECTED'])));
      AnalyticsService.trackEvent({
        userId: payment.userId,
        type: 'payment.failed',
        subjectType: 'payment',
        subjectId: payment.id,
        data: { gateway },
      });
      return { redirect: '/app/wallet?payment=failed', replayed: false, verified: false };
    }

    const { replayed } = await withIdempotency(
      `payment-verify:${payment.id}`,
      'payment-verify',
      () => PaymentService.applyVerifiedEffects(payment.id, verifyResult.refId),
      86_400,
      payment.userId,
    );

    return { redirect: PaymentService.successRedirect(payment), replayed, verified: true };
  },

  successRedirect(payment: PaymentRow): string {
    return payment.purpose === 'SUBSCRIPTION' ? '/app/subscription?payment=ok' : '/app/wallet?payment=ok';
  },

  /** Transactional effects of a verified payment (called once per payment). */
  async applyVerifiedEffects(paymentId: number, refId?: string): Promise<{ redirect: string }> {
    await withTransaction(async (tx) => {
      // CAS flip: only the first verification applies effects.
      const updated = await tx
        .update(payments)
        .set({
          status: 'VERIFIED',
          verifiedAt: new Date(),
          gatewayRef: refId?.slice(0, 128),
          updatedAt: new Date(),
        })
        .where(and(eq(payments.id, paymentId), inArray(payments.status, ['CREATED', 'REDIRECTED'])));
      if ((updated[0]?.affectedRows ?? 0) === 0) return; // already applied elsewhere

      const rows = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      const payment = rows[0];
      if (!payment) return;

      if (payment.purpose === 'SUBSCRIPTION' && payment.planId !== null) {
        const planRows = await tx.select().from(plans).where(eq(plans.id, payment.planId)).limit(1);
        const plan = planRows[0];
        if (plan) {
          const sub = await SubscriptionService.activatePlan(tx, payment.userId, plan.id, 1, payment.id);
          await tx.update(payments).set({ subscriptionId: sub.id }).where(eq(payments.id, payment.id));
          await SubscriptionService.notifySubscriptionActivated(tx, payment.userId, plan, sub.expiresAt);
        }
      } else if (payment.purpose === 'WALLET_TOPUP') {
        await WalletService.credit(tx, payment.userId, payment.amount, {
          referenceId: payment.id,
          idempotencyKey: `wallet-topup:${payment.id}`,
          description: 'شارژ کیف پول',
        });
      }

      // Referral reward: referrer credited on the referred user's first verified payment.
      await ReferralService.rewardIfEligible(tx, payment.userId, payment.id);

      AnalyticsService.trackEvent({
        userId: payment.userId,
        type: 'payment.completed',
        subjectType: 'payment',
        subjectId: payment.id,
        data: { purpose: payment.purpose, amount: payment.amount, gateway: payment.gateway },
      });
    });
    return { redirect: '' }; // redirect computed by caller via successRedirect
  },

  /** Admin: paginated payment list with user email (safe columns only). */
  async listAll(
    page: number,
    limit: number,
    status?: PaymentRow['status'],
  ): Promise<{ items: Array<PaymentRow & { userEmail: string }>; total: number }> {
    const where = status ? eq(payments.status, status) : undefined;
    const [items, totalRows] = await Promise.all([
      db
        .select({ payment: payments, email: users.email })
        .from(payments)
        .innerJoin(users, eq(payments.userId, users.id))
        .where(where)
        .orderBy(desc(payments.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(payments).where(where),
    ]);
    return {
      items: items.map((row) => ({ ...row.payment, userEmail: row.email })),
      total: Number(totalRows[0]?.value ?? 0),
    };
  },

  async countVerifiedInMonth(year: number, monthIndex0: number): Promise<number> {
    const start = new Date(Date.UTC(year, monthIndex0, 1));
    const end = new Date(Date.UTC(year, monthIndex0 + 1, 1));
    const rows = await db
      .select({ value: count() })
      .from(payments)
      .where(and(eq(payments.status, 'VERIFIED'), sql`${payments.verifiedAt} >= ${start}`, sql`${payments.verifiedAt} < ${end}`));
    return Number(rows[0]?.value ?? 0);
  },

  async activeSubscriptionCount(): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'ACTIVE'));
    return Number(rows[0]?.value ?? 0);
  },
};
