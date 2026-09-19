/**
 * Billing routes: plans, subscription, payments (create/callback/list),
 * wallet and referrals. Envelope responses; Persian safe messages.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validationError } from '../../core/errors.js';
import { sendCreated, sendOk } from '../../core/envelope.js';
import { publishLimiter } from '../../security/rate-limit.js';
import { requireAuth } from '../../security/session.js';
import { PaymentService, parseGatewayName } from './payment.service.js';
import { ReferralService } from './referral.service.js';
import { SubscriptionService } from './subscription.service.js';
import { WalletService } from './wallet.service.js';

function parsePaginationQuery(query: unknown): { page: number; limit: number } {
  const parsed = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .safeParse(query);
  if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
  return parsed.data;
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

export function registerBillingRoutes(app: FastifyInstance): void {
  /* ------------------------------- Plans (public) ------------------------------ */
  app.get('/api/v1/plans', async (_request, reply) => {
    const plans = await SubscriptionService.listActivePlans();
    return sendOk(reply, {
      items: plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        limits: plan.limits,
        sortOrder: plan.sortOrder,
      })),
    });
  });

  /* ------------------------------ Subscription ------------------------------ */
  app.get('/api/v1/subscription', { preHandler: requireAuth }, async (request, reply) => {
    const overview = await SubscriptionService.getOverview(request.currentUser!.id);
    return sendOk(reply, {
      subscription: overview.subscription,
      plan: {
        id: overview.plan.id,
        code: overview.plan.code,
        name: overview.plan.name,
        priceMonthly: overview.plan.priceMonthly,
      },
      limits: overview.limits,
    });
  });

  /** Usage dashboard: effective plan + days remaining + counters vs plan limits. */
  app.get('/api/v1/subscription/usage', { preHandler: requireAuth }, async (request, reply) => {
    const summary = await SubscriptionService.getUsageSummary(request.currentUser!.id);
    return sendOk(reply, {
      plan: summary.plan,
      subscriptionStatus: summary.subscriptionStatus,
      expiresAt: summary.expiresAt,
      daysRemaining: summary.daysRemaining,
      usage: summary.usage,
    });
  });

  app.post(
    '/api/v1/subscription/change',
    { preHandler: requireAuth, ...publishLimiter.config },
    async (request, reply) => {
      const parsed = z
        .object({
          planId: z.coerce.number().int().min(1),
          // renew:true = explicit تمدید of the CURRENT active plan (skips the
          // same-plan conflict; extends from the current expiry after payment).
          renew: z.boolean().optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
      const result = await SubscriptionService.changePlan(request.currentUser!.id, parsed.data.planId, {
        renew: parsed.data.renew,
      });
      return sendOk(reply, result, result.applied ? 200 : 201);
    },
  );

  /* -------------------------------- Payments -------------------------------- */
  /** Available payment methods (admin settings driven; card info only when enabled). */
  app.get('/api/v1/billing/payment-methods', { preHandler: requireAuth }, async (_request, reply) => {
    const methods = await PaymentService.getPaymentMethods();
    return sendOk(reply, methods);
  });

  /** Card-to-card (manual) payment request: creates a PENDING payment with the transfer reference. */
  app.post('/api/v1/payments/card', { preHandler: requireAuth, ...publishLimiter.config }, async (request, reply) => {
    const parsed = z
      .object({
        purpose: z.enum(['SUBSCRIPTION', 'WALLET_TOPUP']),
        planId: z.coerce.number().int().min(1).optional(),
        amount: z.coerce.number().int().min(1).optional(),
        reference: z.string().min(4).max(64),
      })
      .safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());

    const result = await PaymentService.createCardPayment(request.currentUser!.id, {
      purpose: parsed.data.purpose,
      planId: parsed.data.planId,
      amount: parsed.data.amount,
      reference: parsed.data.reference,
    });
    return sendCreated(reply, {
      paymentId: result.paymentId,
      amount: result.amount,
      status: result.status,
    });
  });

  app.post('/api/v1/payments', { preHandler: requireAuth, ...publishLimiter.config }, async (request, reply) => {
    const parsed = z
      .object({
        purpose: z.enum(['SUBSCRIPTION', 'WALLET_TOPUP']),
        planId: z.coerce.number().int().min(1).optional(),
        amount: z.coerce.number().int().min(1).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());

    const result = await PaymentService.createPayment(request.currentUser!.id, {
      purpose: parsed.data.purpose,
      planId: parsed.data.planId,
      amount: parsed.data.amount,
    });
    return sendCreated(reply, {
      paymentId: result.paymentId,
      redirectUrl: result.redirectUrl,
      amount: result.amount,
      gateway: result.gateway,
    });
  });

  app.get('/api/v1/payments', { preHandler: requireAuth }, async (request, reply) => {
    const { page, limit } = parsePaginationQuery(request.query);
    const { items, total } = await PaymentService.listForUser(request.currentUser!.id, page, limit);
    return sendOk(reply, {
      items: items.map((p) => ({
        id: p.id,
        purpose: p.purpose,
        planId: p.planId,
        amount: p.amount,
        method: p.method,
        gateway: p.gateway,
        status: p.status,
        reference: p.reference,
        authority: p.authority,
        gatewayRef: p.gatewayRef,
        verifiedAt: p.verifiedAt,
        createdAt: p.createdAt,
      })),
      total,
      page,
      limit,
    });
  });

  /**
   * Gateway browser-return endpoint (public; server-to-server verify happens
   * here). GET only — the gateway redirects the user's browser to this URL.
   */
  app.get('/api/v1/payments/callback/:gateway', async (request, reply) => {
    const gatewayParam = (request.params as Record<string, string | undefined>)['gateway'] ?? '';
    const gateway = parseGatewayName(gatewayParam);
    const query = asRecord(request.query);
    const payment = await PaymentService.locateCallbackPayment(gateway, query);
    const result = await PaymentService.verifyCallback(gateway, payment, query);
    return sendOk(reply, { redirect: result.redirect, verified: result.verified, replayed: result.replayed });
  });

  /* --------------------------------- Wallet --------------------------------- */
  app.get('/api/v1/wallet', { preHandler: requireAuth }, async (request, reply) => {
    const { wallet, entries } = await WalletService.getWalletSummary(request.currentUser!.id);
    return sendOk(reply, {
      balance: wallet.balance,
      currency: wallet.currency,
      entries: entries.map((e) => ({
        id: e.id,
        direction: e.direction,
        type: e.type,
        amount: e.amount,
        balanceAfter: e.balanceAfter,
        description: e.description,
        createdAt: e.createdAt,
      })),
    });
  });

  app.get('/api/v1/wallet/entries', { preHandler: requireAuth }, async (request, reply) => {
    const { page, limit } = parsePaginationQuery(request.query);
    const { items, total } = await WalletService.listEntries(request.currentUser!.id, page, limit);
    return sendOk(reply, { items, total, page, limit });
  });

  app.post('/api/v1/wallet/topup', { preHandler: requireAuth, ...publishLimiter.config }, async (request, reply) => {
    const parsed = z
      .object({ amount: z.coerce.number().int().min(100_000).optional() })
      .safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const result = await PaymentService.createPayment(request.currentUser!.id, {
      purpose: 'WALLET_TOPUP',
      amount: parsed.data.amount ?? PaymentService.walletTopupPresets()[0],
    });
    return sendCreated(reply, {
      paymentId: result.paymentId,
      redirectUrl: result.redirectUrl,
      amount: result.amount,
      gateway: result.gateway,
      presets: PaymentService.walletTopupPresets(),
    });
  });

  /* -------------------------------- Referrals ------------------------------- */
  app.get('/api/v1/referrals', { preHandler: requireAuth }, async (request, reply) => {
    const summary = await ReferralService.getSummary(request.currentUser!.id);
    return sendOk(reply, summary);
  });
}
