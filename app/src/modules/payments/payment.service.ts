import { and, desc, eq, count } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { payments, plans, referrals, referralRewards } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { runIdempotent } from '../../core/idempotency.js';
import { emitEvent } from '../../core/events.js';
import { audit } from '../../core/audit.js';
import { loadEnv } from '../../config/env.js';
import { ZarinpalAdapter } from '../../providers/payments/zarinpal.js';
import { activateSubscriptionTx } from '../subscriptions/plan.service.js';
import type { Tx } from '../subscriptions/plan.service.js';
import { moveMoneyTx, pointCreditTx } from '../wallet/wallet.service.js';

export const POINT_TO_RIAL = 10; // ۱ امتیاز = ۱۰ ریال
const WALLET_TOPUP_MIN = 100_000; // Rial

function gateway(): ZarinpalAdapter {
  const env = loadEnv();
  return new ZarinpalAdapter(env.PAYMENT_MERCHANT_ID ?? '', env.NODE_ENV !== 'production');
}

export interface CreatedPaymentResult {
  paymentId: string;
  redirectUrl: string;
}

async function createPaymentRow(input: {
  tenantId: string;
  purpose: 'SUBSCRIPTION' | 'WALLET_TOPUP';
  planId: string | null;
  months: number;
  amountRial: number;
  description: string;
}): Promise<CreatedPaymentResult> {
  const db = getDb();
  const env = loadEnv();
  const id = newId();
  const gw = gateway();
  const created = await gw.createPayment({
    amountRial: input.amountRial,
    description: input.description,
    callbackUrl: `${env.API_URL}/api/v1/payments/callback?paymentId=${id}`,
  });
  await db.insert(payments).values({
    id,
    tenantId: input.tenantId,
    purpose: input.purpose,
    planId: input.planId,
    months: input.months,
    amountRial: input.amountRial,
    gateway: gw.id,
    authority: created.authority,
    state: 'CREATED',
  });
  await emitEvent({
    name: 'payment.created',
    tenantId: input.tenantId,
    subjectType: 'payment',
    subjectId: id,
    props: { purpose: input.purpose, amountRial: input.amountRial },
  });
  return { paymentId: id, redirectUrl: created.redirectUrl };
}

/** Subscription purchase payment (plan must be active; free plan has no checkout). */
export async function createSubscriptionPayment(
  tenantId: string,
  planCode: string,
  months: number
): Promise<CreatedPaymentResult> {
  const db = getDb();
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.code, planCode), eq(plans.isActive, 1)))
    .limit(1);
  if (!plan) throw new AppError(ERR.NOT_FOUND('پلن'));

  const amountRial = Number(plan.priceRial) * months;
  if (amountRial <= 0) throw new AppError(ERR.VALIDATION('این پلن رایگان است.'));

  return createPaymentRow({
    tenantId,
    purpose: 'SUBSCRIPTION',
    planId: plan.id,
    months,
    amountRial,
    description: 'خرید اشتراک پُستیار',
  });
}

/** Wallet top-up payment (§34). */
export async function createWalletTopup(tenantId: string, amountRial: number): Promise<CreatedPaymentResult> {
  if (!Number.isInteger(amountRial) || amountRial < WALLET_TOPUP_MIN) {
    throw new AppError(ERR.VALIDATION('حداقل مبلغ شارژ کیف پول ۱۰۰٬۰۰۰ ریال است.'));
  }
  return createPaymentRow({
    tenantId,
    purpose: 'WALLET_TOPUP',
    planId: null,
    months: 1,
    amountRial,
    description: 'شارژ کیف پول پُستیار',
  });
}

export interface CallbackQuery {
  paymentId: string;
  Authority?: string;
  Status?: string;
}

export interface CallbackResult {
  ok: boolean;
  message: string;
}

/**
 * Referral first-purchase hook (§36): ۱۰٪ of the payment as POINTS for the
 * referrer, exactly-once per referral via uq_referral_rewards. Must never
 * break the payment path — every failure is swallowed and logged.
 */
export async function referralHookFirstPurchase(tenantId: string, amountRial: number, tx?: Tx): Promise<void> {
  try {
    if (tx) {
      await applyFirstPurchaseReward(tx, tenantId, amountRial);
    } else {
      const db = getDb();
      await db.transaction((t) => applyFirstPurchaseReward(t, tenantId, amountRial));
    }
  } catch (err) {
    // The referral reward is best-effort; it must never fail the payment.
    audit({ action: 'referral.reward_failed', subjectType: 'user', subjectId: tenantId, meta: { reason: String((err as Error).message).slice(0, 120) } }).catch(
      () => undefined
    );
  }
}

async function applyFirstPurchaseReward(tx: Tx, tenantId: string, amountRial: number): Promise<void> {
  const [referral] = await tx
    .select()
    .from(referrals)
    .where(and(eq(referrals.referredTenantId, tenantId), eq(referrals.state, 'REGISTERED')))
    .limit(1);
  if (!referral) return;

  const points = Math.floor((amountRial * 0.1) / POINT_TO_RIAL); // ۱۰٪ پرداخت به امتیاز
  if (points <= 0) return;

  try {
    await tx.insert(referralRewards).values({
      id: newId(),
      referralId: referral.id,
      rewardKind: 'FIRST_PURCHASE',
      amount: points,
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(String(e?.message ?? ''))) return; // idempotent
    throw err;
  }

  await pointCreditTx(tx, referral.referrerTenantId, points, { type: 'referral_first_purchase', id: referral.id }, 'پاداش اولین خرید زیرمجموعه');
  await tx.update(referrals).set({ state: 'REWARDED' }).where(eq(referrals.id, referral.id));

  await emitEvent({
    name: 'referral.rewarded',
    tenantId: referral.referrerTenantId,
    subjectType: 'referral',
    subjectId: referral.id,
    props: { rewardKind: 'FIRST_PURCHASE', points },
  });
  await audit({
    action: 'referral.first_purchase_reward',
    actorId: tenantId,
    subjectType: 'referral',
    subjectId: referral.id,
    meta: { points },
  });
}

/**
 * Gateway callback (§117): real server-side verification via
 * gateway.verifyPayment — the browser-reported status is never trusted.
 * Wrapped in durable idempotency (scope payment_verify, 24h). All financial
 * side effects happen in the same transaction as the VERIFIED flip.
 */
export async function handleCallback(q: CallbackQuery): Promise<CallbackResult> {
  try {
    const { replayed, value } = await runIdempotent<CallbackResult>(
      'payment_verify',
      q.paymentId,
      86_400,
      () => verifyAndSettle(q)
    );
    if (replayed && value.ok) {
      return { ok: true, message: 'پرداخت شما پیش‌تر تأیید و اعمال شده است.' };
    }
    return value;
  } catch (err) {
    if (err instanceof Error && err.message === 'IDEMPOTENCY_IN_PROGRESS') {
      return { ok: false, message: 'پردازش این پرداخت در حال انجام است. نتیجه به‌زودی اعمال می‌شود.' };
    }
    if (err instanceof AppError && err.code === 'NOT_FOUND') {
      return { ok: false, message: 'پرداخت مورد نظر یافت نشد.' };
    }
    return { ok: false, message: 'تأیید پرداخت ناموفق بود. اگر مبلغ کسر شده باشد به‌صورت خودکار بازگردانده می‌شود.' };
  }
}

async function verifyAndSettle(q: CallbackQuery): Promise<CallbackResult> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, q.paymentId)).limit(1);
  if (!payment) throw new AppError(ERR.NOT_FOUND('پرداخت'));

  // Authority binding: callback authority must match the one we created.
  if (q.Authority && payment.authority && q.Authority !== payment.authority) {
    throw new AppError(ERR.PAYMENT_VERIFY_FAILED());
  }

  // Already settled (browser refresh / duplicate redirect)
  if (payment.state === 'VERIFIED') {
    return { ok: true, message: 'پرداخت شما قبلاً تأیید شده است.' };
  }
  if (payment.state === 'CANCELLED' || payment.state === 'REFUNDED') {
    return { ok: false, message: 'این پرداخت قابل تأیید نیست.' };
  }

  // User cancelled or gateway reported failure
  if (q.Status !== 'OK') {
    await db
      .update(payments)
      .set({ state: 'FAILED', metaJson: { gatewayStatus: q.Status ?? 'NOK' } })
      .where(and(eq(payments.id, payment.id), eq(payments.state, payment.state)));
    await emitEvent({ name: 'payment.failed', tenantId: payment.tenantId, subjectType: 'payment', subjectId: payment.id });
    return { ok: false, message: 'پرداخت ناموفق بود یا لغو شد.' };
  }

  if (!payment.authority) throw new AppError(ERR.PAYMENT_VERIFY_FAILED());

  const gw = gateway();
  const verified = await gw.verifyPayment(Number(payment.amountRial), payment.authority);
  if (!verified.ok) {
    await db
      .update(payments)
      .set({ state: 'FAILED', metaJson: { gatewayCode: verified.code } })
      .where(and(eq(payments.id, payment.id), eq(payments.state, payment.state)));
    await emitEvent({ name: 'payment.failed', tenantId: payment.tenantId, subjectType: 'payment', subjectId: payment.id });
    return { ok: false, message: 'تأیید پرداخت نزد درگاه ناموفق بود. اگر مبلغ کسر شده باشد به‌صورت خودکار بازگردانده می‌شود.' };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({ state: 'VERIFIED', verifiedAt: new Date(), gatewayRef: verified.refId ?? null })
      .where(and(eq(payments.id, payment.id), eq(payments.state, payment.state)));

    if (payment.purpose === 'SUBSCRIPTION' && payment.planId) {
      await activateSubscriptionTx(tx, payment.tenantId, payment.planId, payment.months);
      await referralHookFirstPurchase(payment.tenantId, Number(payment.amountRial), tx);
    } else if (payment.purpose === 'WALLET_TOPUP') {
      await moveMoneyTx(tx, payment.tenantId, 'CREDIT', Number(payment.amountRial), { type: 'payment', id: payment.id }, 'شارژ کیف پول');
    }
  });

  await emitEvent({
    name: 'payment.completed',
    tenantId: payment.tenantId,
    subjectType: 'payment',
    subjectId: payment.id,
    props: { purpose: payment.purpose, amountRial: Number(payment.amountRial), refId: verified.refId },
  });
  await audit({
    action: 'payment.verified',
    actorId: payment.tenantId,
    subjectType: 'payment',
    subjectId: payment.id,
    meta: { purpose: payment.purpose, amountRial: Number(payment.amountRial), gateway: payment.gateway },
  });

  return {
    ok: true,
    message: payment.purpose === 'SUBSCRIPTION' ? 'پرداخت با موفقیت انجام و اشتراک شما فعال شد.' : 'پرداخت با موفقیت انجام و کیف پول شما شارژ شد.',
  };
}

export interface PaymentListItem {
  id: string;
  purpose: string;
  planId: string | null;
  months: number;
  amountRial: number;
  gateway: string;
  state: string;
  verifiedAt: Date | null;
  createdAt: Date;
}

export async function listPayments(
  tenantId: string,
  page: number,
  pageSize: number
): Promise<{ items: PaymentListItem[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, Math.floor(page));
  const size = Math.min(100, Math.max(1, Math.floor(pageSize)));
  const [totalRow] = await db.select({ value: count() }).from(payments).where(eq(payments.tenantId, tenantId));
  const rows = await db
    .select({
      id: payments.id,
      purpose: payments.purpose,
      planId: payments.planId,
      months: payments.months,
      amountRial: payments.amountRial,
      gateway: payments.gateway,
      state: payments.state,
      verifiedAt: payments.verifiedAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(eq(payments.tenantId, tenantId))
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
