/**
 * Bots service: registration (token encrypted at rest, live getMe verify),
 * lifecycle (verify/enable/disable/delete), events listing with privacy
 * sanitization and bot users.
 *
 * Provider contract (providers/types.ts + registry.ts, owned by 4-b-1):
 *   getBotProvider(kind, token) → BotProvider with getMe/setWebhook/
 *   deleteWebhook/getUpdates/sendMessage and a capabilities map.
 */
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { decryptSecret, encryptSecret, randomToken, timingSafeEqualStr } from '../../core/crypto.js';
import { AnalyticsService } from '../../core/events.js';
import { conflict, notFound, providerError, validationError } from '../../core/errors.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { botEvents, botUsers, bots, workflows } from '../../db/schema.js';
import { SubscriptionService } from '../billing/subscription.service.js';
import { getBotProvider } from '../../providers/registry.js';
import type { BotProvider, ProviderKind } from '../../providers/types.js';

export type BotRow = typeof bots.$inferSelect;

export const PROVIDER_KINDS = ['TELEGRAM', 'BALE', 'RUBIKA'] as const;

export const CommandsSchema = z
  .array(
    z.object({
      command: z.string().regex(/^\/?[A-Za-z0-9_]{1,32}$/),
      description: z.string().max(100),
      response: z.string().min(1).max(500),
    }),
  )
  .max(20);

export const AiConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.string().max(40).default('OPENAI'),
  model: z.string().max(80).optional(),
  systemPrompt: z.string().max(1000).optional(),
  maxCreditsPerReply: z.number().int().min(1).max(20).optional(),
});

export interface BotMeResult {
  ok: boolean;
  id?: string;
  username?: string;
  title?: string;
  error?: string;
}

export function webhookUrlFor(kind: ProviderKind, botId: number): string {
  const slug = kind.toLowerCase();
  return `${env.API_URL}/api/v1/webhooks/${slug}/${botId}`;
}

async function verifyWithProvider(provider: BotProvider): Promise<BotMeResult> {
  const me = await provider.getMe();
  return me;
}

/** Never return token material to clients. */
function serializeBot(bot: BotRow) {
  return {
    id: bot.id,
    provider: bot.provider,
    username: bot.username,
    title: bot.title,
    isEnabled: bot.isEnabled,
    status: bot.status,
    webhookState: bot.webhookState,
    commands: bot.commands,
    aiConfig: bot.aiConfig,
    lastError: bot.lastError,
    lastVerifiedAt: bot.lastVerifiedAt,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  };
}

export const BotService = {
  serializeBot,

  async list(userId: number, page: number, limit: number): Promise<{ items: ReturnType<typeof serializeBot>[]; total: number }> {
    const [rows, totalRows] = await Promise.all([
      db.select().from(bots).where(eq(bots.userId, userId)).orderBy(desc(bots.id)).limit(limit).offset((page - 1) * limit),
      db.select({ value: count() }).from(bots).where(eq(bots.userId, userId)),
    ]);
    return { items: rows.map(serializeBot), total: Number(totalRows[0]?.value ?? 0) };
  },

  async get(userId: number, botId: number): Promise<BotRow> {
    const rows = await db
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, userId)))
      .limit(1);
    const bot = rows[0];
    if (!bot) throw notFound('ربات یافت نشد.');
    return bot;
  },

  /** Register a bot token: plan-limited, encrypted at rest, verified live. */
  async create(
    userId: number,
    input: { provider: ProviderKind; token: string; title?: string },
  ): Promise<{ bot: BotRow; verified: boolean }> {
    const plan = await SubscriptionService.resolvePlanForUser(userId);
    const countRows = await db.select({ value: count() }).from(bots).where(eq(bots.userId, userId));
    const used = Number(countRows[0]?.value ?? 0);
    if (plan.limits.bots <= used) {
      throw conflict(`سقف تعداد ربات‌ها در پلن «${plan.name}» پر شده است. برای افزودن ربات جدید پلن خود را ارتقا دهید.`);
    }

    const provider = getBotProvider(input.provider, input.token);
    let me: BotMeResult;
    try {
      me = await verifyWithProvider(provider);
    } catch {
      throw providerError('بررسی توکن ربات ناموفق بود. اتصال به سرویس‌دهنده برقرار نشد.');
    }
    if (!me.ok) {
      throw validationError('توکن ربات معتبر نیست یا سرویس‌دهنده آن را نپذیرفت.', { providerError: me.error ?? undefined });
    }

    const inserted = await db
      .insert(bots)
      .values({
        userId,
        provider: input.provider as 'TELEGRAM' | 'BALE' | 'RUBIKA',
        tokenEncrypted: encryptSecret(input.token),
        username: me.username ?? null,
        title: input.title ?? me.title ?? me.username ?? null,
        status: 'ACTIVE',
        isEnabled: true,
        webhookSecret: randomToken(24),
        webhookState: 'UNREGISTERED',
        commands: [],
        aiConfig: null,
        lastVerifiedAt: new Date(),
      })
      .$returningId();
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error('bot_insert_failed');

    const rows = await db.select().from(bots).where(eq(bots.id, Number(id))).limit(1);
    const bot = rows[0];
    if (!bot) throw new Error('bot_missing');

    AnalyticsService.trackEvent({
      userId,
      type: 'bot.created',
      subjectType: 'bot',
      subjectId: bot.id,
      data: { provider: bot.provider, username: bot.username },
    });

    return { bot, verified: true };
  },

  async update(
    userId: number,
    botId: number,
    patch: { title?: string; commands?: z.infer<typeof CommandsSchema>; aiConfig?: z.infer<typeof AiConfigSchema>; token?: string },
  ): Promise<BotRow> {
    const bot = await BotService.get(userId, botId);
    const updates: Partial<typeof bots.$inferInsert> = { updatedAt: new Date() };

    if (patch.title !== undefined) updates.title = patch.title.slice(0, 190);
    if (patch.commands !== undefined) {
      updates.commands = patch.commands.map((cmd) => ({
        command: cmd.command.startsWith('/') ? cmd.command : `/${cmd.command}`,
        description: cmd.description,
        response: cmd.response,
      }));
    }
    if (patch.aiConfig !== undefined) updates.aiConfig = patch.aiConfig;

    if (patch.token !== undefined && patch.token.length > 0) {
      const provider = getBotProvider(bot.provider as ProviderKind, patch.token);
      let me: BotMeResult;
      try {
        me = await verifyWithProvider(provider);
      } catch {
        throw providerError('بررسی توکن جدید ناموفق بود. اتصال به سرویس‌دهنده برقرار نشد.');
      }
      if (!me.ok) throw validationError('توکن جدید ربات معتبر نیست.');
      updates.tokenEncrypted = encryptSecret(patch.token);
      updates.username = me.username ?? bot.username;
      updates.lastVerifiedAt = new Date();
      updates.lastError = null;
    }

    await db.update(bots).set(updates).where(eq(bots.id, bot.id));
    return BotService.get(userId, botId);
  },

  /** Delete bot + dependent rows; deregister webhook where supported. */
  async delete(userId: number, botId: number): Promise<void> {
    const bot = await BotService.get(userId, botId);
    if (bot.webhookState === 'REGISTERED') {
      try {
        const provider = getBotProvider(bot.provider as ProviderKind, decryptSecret(bot.tokenEncrypted));
        await provider.deleteWebhook();
      } catch {
        // Best-effort cleanup; deletion proceeds regardless.
      }
    }
    await db.delete(botEvents).where(eq(botEvents.botId, bot.id));
    await db.delete(botUsers).where(eq(botUsers.botId, bot.id));
    await db.delete(workflows).where(eq(workflows.botId, bot.id));
    await db.delete(bots).where(eq(bots.id, bot.id));
    AnalyticsService.trackEvent({
      userId,
      type: 'bot.deleted',
      subjectType: 'bot',
      subjectId: bot.id,
      data: { provider: bot.provider },
    });
  },

  /** Live getMe check → ACTIVE/ERROR. */
  async verify(userId: number, botId: number): Promise<BotRow> {
    const bot = await BotService.get(userId, botId);
    const provider = getBotProvider(bot.provider as ProviderKind, decryptSecret(bot.tokenEncrypted));
    let me: BotMeResult;
    try {
      me = await verifyWithProvider(provider);
    } catch {
      me = { ok: false, error: 'اتصال به سرویس‌دهنده برقرار نشد.' };
    }
    await db
      .update(bots)
      .set({
        status: me.ok ? 'ACTIVE' : 'ERROR',
        lastError: me.ok ? null : (me.error ?? 'توکن ربات معتبر نیست.'),
        lastVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bots.id, bot.id));
    AnalyticsService.trackEvent({
      userId,
      type: 'bot.verified',
      subjectType: 'bot',
      subjectId: bot.id,
      data: { ok: me.ok },
    });
    return BotService.get(userId, botId);
  },

  /** Enable: re-register webhook where supported, else POLLING mode. */
  async enable(userId: number, botId: number): Promise<BotRow> {
    const bot = await BotService.get(userId, botId);
    const kind = bot.provider as ProviderKind;
    const provider = getBotProvider(kind, decryptSecret(bot.tokenEncrypted));

    let webhookState: BotRow['webhookState'] = bot.webhookState;
    if (provider.capabilities.webhookRegistration) {
      let registered = false;
      try {
        const result = await provider.setWebhook(webhookUrlFor(kind, bot.id), bot.webhookSecret);
        registered = result.ok;
      } catch (err) {
        AnalyticsService.trackEvent({
          userId,
          type: 'bot.webhook.registration_failed',
          subjectType: 'bot',
          subjectId: bot.id,
          data: { error: err instanceof Error ? err.message : String(err) },
        });
      }
      webhookState = registered ? 'REGISTERED' : 'POLLING';
    } else {
      webhookState = 'POLLING';
    }

    await db
      .update(bots)
      .set({
        status: 'ACTIVE',
        isEnabled: true,
        webhookState,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(bots.id, bot.id));
    return BotService.get(userId, botId);
  },

  /** Disable: delete webhook where registered (honest, bounded). */
  async disable(userId: number, botId: number): Promise<BotRow> {
    const bot = await BotService.get(userId, botId);
    if (bot.webhookState === 'REGISTERED') {
      try {
        const provider = getBotProvider(bot.provider as ProviderKind, decryptSecret(bot.tokenEncrypted));
        await provider.deleteWebhook();
      } catch {
        // Provider unreachable — state flips anyway; re-enable will retry.
      }
    }
    await db
      .update(bots)
      .set({ status: 'DISABLED', isEnabled: false, webhookState: 'UNREGISTERED', updatedAt: new Date() })
      .where(eq(bots.id, bot.id));
    return BotService.get(userId, botId);
  },

  /** Bot events (privacy-sanitized: raw bodies clipped to 200 chars). */
  async listEvents(
    userId: number,
    botId: number,
    page: number,
    limit: number,
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const bot = await BotService.get(userId, botId);
    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(botEvents)
        .where(eq(botEvents.botId, bot.id))
        .orderBy(desc(botEvents.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(botEvents).where(eq(botEvents.botId, bot.id)),
    ]);
    return {
      items: rows.map((event) => ({
        id: event.id,
        type: event.type,
        chatId: event.chatId,
        senderRef: event.senderRef,
        payload: sanitizeEventPayload(event.payload),
        processedAt: event.processedAt,
        createdAt: event.createdAt,
      })),
      total: Number(totalRows[0]?.value ?? 0),
    };
  },

  async listBotUsers(
    userId: number,
    botId: number,
    page: number,
    limit: number,
  ): Promise<{ items: Array<typeof botUsers.$inferSelect>; total: number }> {
    const bot = await BotService.get(userId, botId);
    const [items, totalRows] = await Promise.all([
      db
        .select()
        .from(botUsers)
        .where(eq(botUsers.botId, bot.id))
        .orderBy(desc(botUsers.lastSeenAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(botUsers).where(eq(botUsers.botId, bot.id)),
    ]);
    return { items, total: Number(totalRows[0]?.value ?? 0) };
  },

  /** Shared webhook/polling secret check (constant-time). */
  secretMatches(bot: BotRow, presented: string | undefined): boolean {
    if (presented === undefined || presented.length === 0) return false;
    return timingSafeEqualStr(bot.webhookSecret, presented);
  },
};

/** Privacy: strip raw text bodies longer than 200 chars from event payloads. */
export function sanitizeEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
    } else {
      out[key] = value;
    }
  }
  return out;
}
