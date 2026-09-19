import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { loadEnv } from '../../config/env.js';
import { createWalletTopup, handleCallback } from './payment.service.js';
import { listPayments } from './payment.service.js';
import { parseWith } from '../../core/validation.js';

function auth(req: FastifyRequest): { id: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id };
}

const topupSchema = z.object({
  amountRial: z.coerce.number().int().min(100_000).max(2_000_000_000),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

export async function registerPaymentRoutes(app: FastifyInstance): Promise<void> {
  // Start a wallet top-up payment
  app.post('/payments/wallet-topup', { preHandler: [app.requireAuth] }, async (req) => {
    const input = parse(topupSchema, req.body);
    const result = await createWalletTopup(auth(req).id, input.amountRial);
    return { success: true, data: result };
  });

  // Payment history (no authority/gateway refs exposed)
  app.get('/payments', { preHandler: [app.requireAuth] }, async (req) => {
    const q = (req.query ?? {}) as { page?: string; pageSize?: string };
    const page = Number.parseInt(q.page ?? '1', 10) || 1;
    const pageSize = Number.parseInt(q.pageSize ?? '20', 10) || 20;
    const data = await listPayments(auth(req).id, page, pageSize);
    return { success: true, data };
  });

  /**
   * Gateway return (PUBLIC, CSRF-exempt — buildApp skips /api/v1/payments/callback).
   * Never returns JSON to a browser: always 302 back to the dashboard.
   */
  app.get('/payments/callback', async (req, reply) => {
    const env = loadEnv();
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const paymentId = typeof query.paymentId === 'string' ? query.paymentId : '';
    if (!paymentId) {
      return reply.redirect(`${env.APP_URL}/payment/result?payment=failed`);
    }
    const result = await handleCallback({
      paymentId,
      Authority: query.Authority,
      Status: query.Status,
    });
    const flag = result.ok ? 'ok' : 'failed';
    return reply.redirect(`${env.APP_URL}/dashboard/wallet?payment=${flag}`);
  });
}
