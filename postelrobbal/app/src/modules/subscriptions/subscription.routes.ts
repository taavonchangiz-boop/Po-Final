import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { asc, eq, count } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { plans, aiUsageMonthly, posts, channels, bots } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { and, ne, sql } from 'drizzle-orm';
import { getPlanContext } from './plan.service.js';
import { createSubscriptionPayment } from '../payments/payment.service.js';
import { parseWith } from '../../core/validation.js';

function auth(req: FastifyRequest): { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' | 'USER' } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id, role: req.user.role };
}

const checkoutSchema = z.object({
  planCode: z.string().min(1).max(40),
  months: z.coerce.number().int().min(1).max(12),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

export async function registerSubscriptionRoutes(app: FastifyInstance): Promise<void> {
  // Public: plan catalog with Persian names (landing + dashboard)
  app.get('/subscriptions/plans', async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: plans.id,
        code: plans.code,
        nameFa: plans.nameFa,
        priceRial: plans.priceRial,
        periodDays: plans.periodDays,
        limitsJson: plans.limitsJson,
        featuresJson: plans.featuresJson,
        sortOrder: plans.sortOrder,
      })
      .from(plans)
      .where(eq(plans.isActive, 1))
      .orderBy(asc(plans.sortOrder));
    return { success: true, data: { plans: rows } };
  });

  // Current subscription + plan + limits + live usage summary
  app.get('/subscriptions/me', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const tenantId = me.id;
    const ctx = await getPlanContext(tenantId);
    const db = getDb();

    const startedAt = ctx.startedAt;
    const postConds = startedAt
      ? and(eq(posts.tenantId, tenantId), ne(posts.state, 'DRAFT'), ne(posts.state, 'CANCELLED'), sql`${posts.createdAt} >= ${startedAt}`)
      : and(eq(posts.tenantId, tenantId), ne(posts.state, 'DRAFT'), ne(posts.state, 'CANCELLED'));

    const [channelsRow] = await db.select({ value: count() }).from(channels).where(eq(channels.tenantId, tenantId));
    const [botsRow] = await db.select({ value: count() }).from(bots).where(eq(bots.tenantId, tenantId));
    const [postsRow] = await db.select({ value: count() }).from(posts).where(postConds);
    const [schedRow] = await db
      .select({ value: count() })
      .from(posts)
      .where(and(eq(posts.tenantId, tenantId), eq(posts.state, 'SCHEDULED')));
    const periodYm = new Date().toISOString().slice(0, 7);
    const [aiRow] = await db
      .select({ requestCount: aiUsageMonthly.requestCount })
      .from(aiUsageMonthly)
      .where(and(eq(aiUsageMonthly.tenantId, tenantId), eq(aiUsageMonthly.periodYm, periodYm)))
      .limit(1);

    return {
      success: true,
      data: {
        subscription: {
          id: ctx.subscriptionId,
          state: ctx.state,
          startedAt: ctx.startedAt,
          expiresAt: ctx.expiresAt,
        },
        plan: {
          id: ctx.planId,
          code: ctx.planCode,
          nameFa: ctx.planNameFa,
          limits: ctx.limits,
          features: ctx.features,
        },
        usage: {
          channels: Number(channelsRow?.value ?? 0),
          bots: Number(botsRow?.value ?? 0),
          postsThisPeriod: Number(postsRow?.value ?? 0),
          scheduled: Number(schedRow?.value ?? 0),
          aiRequestsThisMonth: Number(aiRow?.requestCount ?? 0),
        },
      },
    };
  });

  // Checkout: create a gateway payment and return the redirect URL
  app.post('/subscriptions/checkout', { preHandler: [app.requireAuth] }, async (req) => {
    const input = parse(checkoutSchema, req.body);
    const result = await createSubscriptionPayment(auth(req).id, input.planCode, input.months);
    return { success: true, data: result };
  });
}
