import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import { Permission } from '../../security/permissions.js';
import { audit } from '../../core/audit.js';
import {
  getOverview,
  listUsers,
  setUserSuspended,
  grantSubscription,
  listAdminPayments,
  approvePayment,
  rejectPayment,
  listAuditLogs,
  listPlans,
  updatePlan,
  getSettings,
  putSettings,
  getPaymentState,
  broadcast,
  releaseChannel,
} from './admin.service.js';
import { putPaymentSettings, PAYMENT_SETTING_KEYS } from '../payments/payment-settings.service.js';

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

function auth(req: FastifyRequest): { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' | 'USER' } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id, role: req.user.role };
}

function paramId(req: FastifyRequest): string {
  const { id } = req.params as { id: string };
  return id;
}

function paging(query: Record<string, string | undefined>): { page: number; pageSize: number } {
  const page = Number.parseInt(query.page ?? '1', 10) || 1;
  const pageSize = Number.parseInt(query.pageSize ?? '20', 10) || 20;
  return { page, pageSize };
}

const grantSchema = z.object({
  planCode: z.string().min(1).max(40),
  months: z.coerce.number().int().min(1).max(12),
});
const planPatchSchema = z.object({
  nameFa: z.string().min(1).max(80).optional(),
  priceRial: z.coerce.number().int().min(0).optional(),
  limitsJson: z.record(z.unknown()).optional(),
  featuresJson: z.record(z.unknown()).optional(),
});
const settingsSchema = z
  .record(z.unknown())
  .refine((r) => Object.keys(r).length > 0, { message: 'بدنهٔ تنظیمات خالی است.' });

// Payment gateway settings (contract 14-contract item 2). cardToCardCards is
// validated strictly: 1..5 cards, cardNumber 16..24 digits, non-empty names.
const paymentCardSchema = z.object({
  id: z.string().min(1).max(40).optional(),
  bankName: z.string().min(1).max(80),
  cardNumber: z.string().regex(/^\d{16,24}$/),
  holderName: z.string().min(1).max(80),
});
const approvePaymentSchema = z.object({
  note: z.string().min(1).max(500).optional(),
});
const rejectPaymentSchema = z.object({
  reason: z.string().min(3).max(500),
});
const broadcastSchema = z.object({
  titleFa: z.string().min(2).max(190),
  bodyFa: z.string().min(2).max(5000),
});
const releaseSchema = z.object({
  platform: z.enum(['telegram', 'bale', 'rubika']),
  channelRef: z.string().min(1).max(190),
});

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // Every admin route requires admin.access; sensitive groups declare a finer permission.
  const access = { preHandler: [app.requirePermission('admin.access')] };
  const usersManage = { preHandler: [app.requirePermission('admin.users.manage')] };
  const paymentsReview = { preHandler: [app.requirePermission('admin.payments.review')] };
  const plansManage = { preHandler: [app.requirePermission('admin.plans.manage')] };
  const settingsManage = { preHandler: [app.requirePermission('admin.settings.manage')] };

  app.get('/admin/overview', access, async () => {
    const data = await getOverview();
    return { success: true, data };
  });

  // ---- users ----
  app.get('/admin/users', access, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    const data = await listUsers(q.search, page, pageSize);
    return { success: true, data };
  });

  app.post('/admin/users/:id/suspend', usersManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    await setUserSuspended(me.id, id, true);
    await audit({ action: 'admin.user_suspended', actorId: me.id, actorRole: me.role, subjectType: 'user', subjectId: id, ip: req.ip });
    return { success: true, data: { ok: true } };
  });

  app.post('/admin/users/:id/activate', usersManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    await setUserSuspended(me.id, id, false);
    await audit({ action: 'admin.user_activated', actorId: me.id, actorRole: me.role, subjectType: 'user', subjectId: id, ip: req.ip });
    return { success: true, data: { ok: true } };
  });

  app.post('/admin/users/:id/grant-subscription', usersManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(grantSchema, req.body);
    const data = await grantSubscription(id, input.planCode, input.months);
    await audit({
      action: 'admin.grant_subscription',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'user',
      subjectId: id,
      ip: req.ip,
      meta: { planCode: input.planCode, months: input.months, subscriptionId: data.subscriptionId },
    });
    return { success: true, data };
  });

  // ---- payments ----
  app.get('/admin/payments', access, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    // "status" per contract; legacy callers may still send "state".
    const data = await listAdminPayments(q.status ?? q.state, page, pageSize);
    return { success: true, data };
  });

  app.post('/admin/payments/:id/approve', paymentsReview, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(approvePaymentSchema, (req.body ?? {}) as unknown);
    const before = await getPaymentState(id);
    const data = await approvePayment(me.id, id, input.note);
    await audit({
      action: 'admin.payment_approved',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'payment',
      subjectId: id,
      ip: req.ip,
      meta: { previousState: before, note: input.note ?? null },
    });
    return { success: true, data };
  });

  app.post('/admin/payments/:id/reject', paymentsReview, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(rejectPaymentSchema, req.body);
    const before = await getPaymentState(id);
    const data = await rejectPayment(me.id, id, input.reason);
    await audit({
      action: 'admin.payment_rejected',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'payment',
      subjectId: id,
      ip: req.ip,
      meta: { previousState: before, reason: input.reason.slice(0, 200) },
    });
    return { success: true, data };
  });

  // ---- audit logs (admin.access) ----
  app.get('/admin/audit-logs', access, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    const data = await listAuditLogs(q.action, page, pageSize);
    return { success: true, data };
  });

  // ---- plans ----
  app.get('/admin/plans', access, async () => {
    const data = await listPlans();
    return { success: true, data: { plans: data } };
  });

  app.put('/admin/plans/:id', plansManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(planPatchSchema, req.body);
    await updatePlan(id, input);
    await audit({
      action: 'admin.plan_updated',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'plan',
      subjectId: id,
      ip: req.ip,
      meta: { fields: Object.keys(input) },
    });
    return { success: true, data: { ok: true } };
  });

  // ---- system settings ----
  app.get('/admin/settings', settingsManage, async () => {
    const data = await getSettings();
    return { success: true, data };
  });

  app.put('/admin/settings', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(settingsSchema, req.body) as Record<string, unknown>;

    // Split payment-gateway keys from the generic object-valued settings.
    // Non-conforming payment payloads (e.g. the legacy admin page round-trips
    // every key as {}) are skipped harmlessly; conforming payloads validate
    // strictly via zod and persist.
    const paymentRaw: Record<string, unknown> = {};
    const generic: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if ((PAYMENT_SETTING_KEYS as readonly string[]).includes(k)) paymentRaw[k] = v;
      else generic[k] = v;
    }

    let updated = 0;
    const updatedKeys: string[] = [];
    if (Object.keys(paymentRaw).length > 0) {
      const patch = paymentRaw as {
        paymentOnlineEnabled?: unknown;
        paymentCardToCardEnabled?: unknown;
        paymentProvider?: unknown;
        cardToCardCards?: unknown;
      };
      const coerced: {
        paymentOnlineEnabled?: boolean;
        paymentCardToCardEnabled?: boolean;
        paymentProvider?: 'zarinpal';
        cardToCardCards?: Array<{ id?: string; bankName: string; cardNumber: string; holderName: string }>;
      } = {};
      if (typeof patch.paymentOnlineEnabled === 'boolean') coerced.paymentOnlineEnabled = patch.paymentOnlineEnabled;
      if (typeof patch.paymentCardToCardEnabled === 'boolean') coerced.paymentCardToCardEnabled = patch.paymentCardToCardEnabled;
      if (patch.paymentProvider === 'zarinpal') coerced.paymentProvider = 'zarinpal';
      if (Array.isArray(patch.cardToCardCards)) coerced.cardToCardCards = parse(paymentCardSchema.array().min(1).max(5), patch.cardToCardCards);
      if (Object.keys(coerced).length > 0) {
        const keys = await putPaymentSettings(coerced);
        updated += keys.length;
        updatedKeys.push(...keys);
      }
    }
    if (Object.keys(generic).length > 0) {
      updated += await putSettings(generic);
      updatedKeys.push(...Object.keys(generic));
    }

    await audit({
      action: 'admin.settings_updated',
      actorId: me.id,
      actorRole: me.role,
      ip: req.ip,
      meta: { keys: updatedKeys },
    });
    return { success: true, data: { updated } };
  });

  // ---- broadcast ----
  app.post('/admin/broadcast', { preHandler: [app.requirePermission('admin.broadcast')] }, async (req) => {
    const me = auth(req);
    const input = parse(broadcastSchema, req.body);
    const notified = await broadcast(me.id, input.titleFa, input.bodyFa);
    await audit({ action: 'admin.broadcast', actorId: me.id, actorRole: me.role, ip: req.ip, meta: { recipients: notified } });
    return { success: true, data: { notified } };
  });

  // ---- channel registry ----
  app.post('/admin/channel-registry/release', usersManage, async (req) => {
    const me = auth(req);
    const input = parse(releaseSchema, req.body);
    await releaseChannel(me.id, input.platform, input.channelRef);
    await audit({
      action: 'admin.channel_released',
      actorId: me.id,
      actorRole: me.role,
      ip: req.ip,
      meta: { platform: input.platform, channelRef: input.channelRef },
    });
    return { success: true, data: { ok: true } };
  });
}
