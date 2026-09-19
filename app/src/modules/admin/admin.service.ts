/**
 * Admin service: platform KPIs, user management (safe columns only), audit
 * log reads, plan/settings management. All mutations are audited via
 * AnalyticsService.trackAudit (core/events.ts).
 */
import { and, count, desc, eq, gt, or, sql } from 'drizzle-orm';
import { conflict, forbidden, notFound, validationError } from '../../core/errors.js';
import { AnalyticsService } from '../../core/events.js';
import { env } from '../../config/env.js';
import { db, withTransaction } from '../../db/client.js';
import {
  auditLogs,
  deliveries,
  payments,
  plans,
  settings,
  supportTickets,
  subscriptions,
  users,
} from '../../db/schema.js';

export type UserRow = typeof users.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;

/** Explicit safe column list — passwordHash is NEVER selected outside auth. */
const SAFE_USER_COLUMNS = {
  id: users.id,
  firstName: users.firstName,
  lastName: users.lastName,
  email: users.email,
  mobile: users.mobile,
  businessName: users.businessName,
  businessType: users.businessType,
  role: users.role,
  status: users.status,
  referralCode: users.referralCode,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
} as const;

export const ADMIN_SETTINGS_WHITELIST = ['referral_reward_amount', 'referral_enabled', 'retention_days'] as const;
export type AdminSettingKey = (typeof ADMIN_SETTINGS_WHITELIST)[number];

/* ------------------------------ Payment settings ------------------------------ */

/**
 * Payment gateway settings keys (task 10-d). Kept OUT of the generic settings
 * whitelist: they have their own typed validation + dedicated admin endpoint
 * (GET/PUT /admin/settings/payment).
 */
export const PAYMENT_SETTINGS_KEYS = {
  onlineEnabled: 'payment.online_gateway_enabled',
  onlineGateway: 'payment.online_gateway',
  cardEnabled: 'payment.card_enabled',
  cardNumber: 'payment.card_number',
  cardHolder: 'payment.card_holder',
} as const;

export interface PaymentSettings {
  online_gateway_enabled: boolean;
  online_gateway: 'ZARINPAL' | 'IDPAY' | 'ZIBAL' | 'MOCK' | null;
  card_enabled: boolean;
  card_number: string;
  card_holder: string;
}

export interface PaymentSettingsPatch {
  onlineGatewayEnabled?: boolean;
  onlineGateway?: 'ZARINPAL' | 'IDPAY' | 'ZIBAL' | 'MOCK';
  cardEnabled?: boolean;
  cardNumber?: string;
  cardHolder?: string;
}

const VALID_GATEWAYS: ReadonlySet<string> = new Set(['ZARINPAL', 'IDPAY', 'ZIBAL', 'MOCK']);

/** Coerce an arbitrary stored JSON value to a boolean (false on mismatch). */
function boolOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeCardNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

export const AdminService = {
  async platformStats(): Promise<{
    users: number;
    activeSubscriptions: number;
    paymentsVerifiedMonthTotal: number;
    deliveriesSent30d: number;
    openTickets: number;
  }> {
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const since30d = new Date(Date.now() - 30 * 86_400_000);

    const [userRows, subRows, verifiedRows, deliveryRows, ticketRows] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, 'ACTIVE')),
      db
        .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
        .from(payments)
        .where(and(eq(payments.status, 'VERIFIED'), sql`${payments.verifiedAt} >= ${monthStart}`)),
      db
        .select({ value: count() })
        .from(deliveries)
        .where(and(eq(deliveries.state, 'SENT'), gt(deliveries.sentAt, since30d))),
      db
        .select({ value: count() })
        .from(supportTickets)
        .where(or(eq(supportTickets.status, 'OPEN'), eq(supportTickets.status, 'PENDING_USER'))),
    ]);

    return {
      users: Number(userRows[0]?.value ?? 0),
      activeSubscriptions: Number(subRows[0]?.value ?? 0),
      paymentsVerifiedMonthTotal: Number(verifiedRows[0]?.total ?? 0),
      deliveriesSent30d: Number(deliveryRows[0]?.value ?? 0),
      openTickets: Number(ticketRows[0]?.value ?? 0),
    };
  },

  async listUsers(page: number, limit: number, q?: string): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const where =
      q !== undefined && q.trim().length > 0
        ? or(
            sql`${users.email} like ${'%' + q.trim() + '%'}`,
            sql`${users.mobile} like ${'%' + q.trim() + '%'}`,
            sql`${users.firstName} like ${'%' + q.trim() + '%'}`,
            sql`${users.lastName} like ${'%' + q.trim() + '%'}`,
          )
        : undefined;

    const [items, totalRows] = await Promise.all([
      db
        .select(SAFE_USER_COLUMNS)
        .from(users)
        .where(where)
        .orderBy(desc(users.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(users).where(where),
    ]);
    return { items, total: Number(totalRows[0]?.value ?? 0) };
  },

  async updateUserRoleStatus(
    actorUserId: number,
    actorRole: UserRow['role'],
    targetUserId: number,
    patch: { role?: UserRow['role']; status?: UserRow['status'] },
  ): Promise<Record<string, unknown>> {
    const targetRows = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    const target = targetRows[0];
    if (!target) throw notFound('کاربر یافت نشد.');

    // Privilege-escalation guard (MAJOR-7): only a SUPER_ADMIN may grant or
    // revoke the SUPER_ADMIN role, and no admin may modify a SUPER_ADMIN
    // account at all. A plain ADMIN promoting anyone to SUPER_ADMIN is a
    // request-forgery class escalation — rejected server-side, not just in UI.
    if (patch.role === 'SUPER_ADMIN' && target.role !== 'SUPER_ADMIN' && actorRole !== 'SUPER_ADMIN') {
      throw forbidden('تغییر نقش به مدیر ارشد تنها توسط مدیر ارشد ممکن است.');
    }
    if (target.role === 'SUPER_ADMIN' && actorRole !== 'SUPER_ADMIN' && actorUserId !== targetUserId) {
      throw forbidden('حساب‌های مدیر ارشد توسط مدیر ارشد قابل تغییر هستند.');
    }

    if (patch.role !== undefined && patch.role !== target.role) {
      // Never demote the LAST SUPER_ADMIN (checked inside the transaction).
      const isLosingSuper = target.role === 'SUPER_ADMIN' && patch.role !== 'SUPER_ADMIN';
      await withTransaction(async (tx) => {
        if (isLosingSuper) {
          const superRows = await tx.select({ value: count() }).from(users).where(eq(users.role, 'SUPER_ADMIN'));
          if (Number(superRows[0]?.value ?? 0) <= 1) {
            throw conflict('حداقل یک مدیر ارشد باید در سیستم باقی بماند.');
          }
        }
        await tx
          .update(users)
          .set({ role: patch.role ?? target.role, status: patch.status ?? target.status, updatedAt: new Date() })
          .where(eq(users.id, targetUserId));
      });
    } else if (patch.status !== undefined && patch.status !== target.status) {
      await db.update(users).set({ status: patch.status, updatedAt: new Date() }).where(eq(users.id, targetUserId));
    }

    AnalyticsService.trackAudit({
      actorUserId,
      action: 'admin.user.updated',
      subjectType: 'user',
      subjectId: targetUserId,
      data: { role: patch.role, status: patch.status },
    });

    const updated = await db.select(SAFE_USER_COLUMNS).from(users).where(eq(users.id, targetUserId)).limit(1);
    const row = updated[0];
    if (!row) throw notFound('کاربر یافت نشد.');
    return row;
  },

  async listAuditLogs(page: number, limit: number, action?: string): Promise<{ items: Array<typeof auditLogs.$inferSelect>; total: number }> {
    const where = action !== undefined ? eq(auditLogs.action, action.slice(0, 60)) : undefined;
    const [items, totalRows] = await Promise.all([
      db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.id)).limit(limit).offset((page - 1) * limit),
      db.select({ value: count() }).from(auditLogs).where(where),
    ]);
    return { items, total: Number(totalRows[0]?.value ?? 0) };
  },

  async listPlans(): Promise<PlanRow[]> {
    return db.select().from(plans).orderBy(plans.sortOrder, plans.id);
  },

  async updatePlan(actorUserId: number, planId: number, patch: Partial<PlanRow>): Promise<PlanRow> {
    const rows = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    const plan = rows[0];
    if (!plan) throw notFound('پلن یافت نشد.');

    const updates: Partial<typeof plans.$inferInsert> = {};
    if (patch.name !== undefined) updates.name = patch.name.slice(0, 100);
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.priceMonthly !== undefined) updates.priceMonthly = patch.priceMonthly;
    if (patch.isActive !== undefined) updates.isActive = patch.isActive;
    if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;
    if (patch.limits !== undefined) updates.limits = patch.limits;
    if (Object.keys(updates).length === 0) throw validationError('تغییری برای اعمال وجود ندارد.');

    await db.update(plans).set(updates).where(eq(plans.id, planId));
    AnalyticsService.trackAudit({
      actorUserId,
      action: 'admin.plan.updated',
      subjectType: 'plan',
      subjectId: planId,
      data: { keys: Object.keys(updates) },
    });
    const updated = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    const updatedPlan = updated[0];
    if (!updatedPlan) throw notFound('پلن یافت نشد.');
    return updatedPlan;
  },

  async getSettings(): Promise<Record<string, unknown>> {
    const rows = await db.select().from(settings);
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      if ((ADMIN_SETTINGS_WHITELIST as readonly string[]).includes(row.key)) {
        out[row.key] = row.value;
      }
    }
    return out;
  },

  async updateSettings(actorUserId: number, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    for (const [key, value] of Object.entries(patch)) {
      if (!(ADMIN_SETTINGS_WHITELIST as readonly string[]).includes(key)) {
        throw validationError(`کلید «${key}» قابل تغییر نیست.`);
      }
      await db
        .insert(settings)
        .values({ key, value, updatedAt: new Date() })
        .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
    }
    AnalyticsService.trackAudit({
      actorUserId,
      action: 'admin.settings.updated',
      subjectType: 'settings',
      data: { keys: Object.keys(patch) },
    });
    return AdminService.getSettings();
  },

  /** Read payment gateway settings with safe defaults (env fallback for the gateway). */
  async getPaymentSettings(): Promise<PaymentSettings> {
    const rows = await db.select().from(settings);
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const storedGateway = byKey.get(PAYMENT_SETTINGS_KEYS.onlineGateway);
    const gateway =
      typeof storedGateway === 'string' && VALID_GATEWAYS.has(storedGateway)
        ? (storedGateway as PaymentSettings['online_gateway'])
        : (env.PAYMENT_PROVIDER ?? null);
    const storedNumber = byKey.get(PAYMENT_SETTINGS_KEYS.cardNumber);
    const storedHolder = byKey.get(PAYMENT_SETTINGS_KEYS.cardHolder);
    return {
      online_gateway_enabled: boolOf(
        byKey.get(PAYMENT_SETTINGS_KEYS.onlineEnabled),
        env.PAYMENT_PROVIDER !== undefined,
      ),
      online_gateway: gateway,
      card_enabled: boolOf(byKey.get(PAYMENT_SETTINGS_KEYS.cardEnabled), false),
      card_number: typeof storedNumber === 'string' ? storedNumber : '',
      card_holder: typeof storedHolder === 'string' ? storedHolder : '',
    };
  },

  /** Validate + upsert payment settings (audited). */
  async updatePaymentSettings(actorUserId: number, patch: PaymentSettingsPatch): Promise<PaymentSettings> {
    const upserts: Array<{ key: string; value: unknown }> = [];

    if (patch.onlineGatewayEnabled !== undefined) {
      upserts.push({ key: PAYMENT_SETTINGS_KEYS.onlineEnabled, value: patch.onlineGatewayEnabled });
    }
    if (patch.onlineGateway !== undefined) {
      upserts.push({ key: PAYMENT_SETTINGS_KEYS.onlineGateway, value: patch.onlineGateway });
    }
    if (patch.cardEnabled !== undefined) {
      upserts.push({ key: PAYMENT_SETTINGS_KEYS.cardEnabled, value: patch.cardEnabled });
    }
    if (patch.cardNumber !== undefined) {
      const normalized = normalizeCardNumber(patch.cardNumber);
      if (normalized.length > 0 && !/^\d{16}$/.test(normalized)) {
        throw validationError('شماره کارت باید ۱۶ رقم باشد.');
      }
      upserts.push({ key: PAYMENT_SETTINGS_KEYS.cardNumber, value: normalized });
    }
    if (patch.cardHolder !== undefined) {
      const holder = patch.cardHolder.trim();
      if (holder.length > 0 && (holder.length < 3 || holder.length > 60)) {
        throw validationError('نام صاحب کارت باید بین ۳ تا ۶۰ کاراکتر باشد.');
      }
      upserts.push({ key: PAYMENT_SETTINGS_KEYS.cardHolder, value: holder });
    }

    // Enabling a method requires its details to be present.
    const current = await AdminService.getPaymentSettings();
    const cardNumber =
      patch.cardNumber !== undefined ? normalizeCardNumber(patch.cardNumber) : current.card_number;
    if (patch.cardEnabled === true && cardNumber.length === 0) {
      throw validationError('برای فعال‌سازی پرداخت کارت به کارت، ابتدا شماره کارت را وارد کنید.');
    }
    const gateway = patch.onlineGateway ?? current.online_gateway;
    if (patch.onlineGatewayEnabled === true && gateway === null) {
      throw validationError('برای فعال‌سازی درگاه آنلاین، ابتدا درگاه را انتخاب کنید.');
    }

    if (upserts.length === 0) throw validationError('تغییری برای اعمال وجود ندارد.');
    for (const { key, value } of upserts) {
      await db
        .insert(settings)
        .values({ key, value, updatedAt: new Date() })
        .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
    }

    AnalyticsService.trackAudit({
      actorUserId,
      action: 'admin.payment_settings.updated',
      subjectType: 'settings',
      data: { keys: upserts.map((u) => u.key) },
    });
    return AdminService.getPaymentSettings();
  },
};
