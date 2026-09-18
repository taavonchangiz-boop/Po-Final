/**
 * Bot routes + public provider webhooks.
 *
 * Webhooks are PUBLIC (rate-limited, CSRF-opted-out via config.csrf=false) and
 * authenticate with the per-bot webhook secret via constant-time header
 * comparison. Rubika has no webhook API — the endpoint answers 501 honestly.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sendOk } from '../../core/envelope.js';
import { validationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { publishLimiter, webhookLimiter } from '../../security/rate-limit.js';
import { requireAuth } from '../../security/session.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { bots } from '../../db/schema.js';
import { BotService, CommandsSchema, AiConfigSchema } from './bots.service.js';
import { ingestBotUpdate } from './bot.engine.js';

const IdParams = z.object({ id: z.coerce.number().int().min(1) });
const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const WEBHOOK_SECRET_HEADERS = {
  telegram: 'x-telegram-bot-api-secret-token',
  baleAlt: 'x-bale-secret-token',
} as const;

async function loadBotForWebhook(botIdRaw: string | undefined) {
  const parsed = z.coerce.number().int().min(1).safeParse(botIdRaw);
  if (!parsed.success) return null;
  const rows = await db.select().from(bots).where(eq(bots.id, parsed.data)).limit(1);
  return rows[0] ?? null;
}

function readHeader(request: { headers: Record<string, unknown> }, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/** 401 with a constant generic body — never reveals which check failed. */
function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.status(401).send({
    success: false,
    error: { code: 'UNAUTHENTICATED', message: 'امضای وب‌هوک معتبر نیست.', requestId: '' },
  });
}

export function registerBotRoutes(app: FastifyInstance): void {
  /* --------------------------------- Bots CRUD --------------------------------- */
  app.get('/api/v1/bots', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = PaginationSchema.safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await BotService.list(request.currentUser!.id, parsed.data.page, parsed.data.limit);
    return sendOk(reply, { items, total, page: parsed.data.page, limit: parsed.data.limit });
  });

  app.post('/api/v1/bots', { preHandler: requireAuth, ...publishLimiter.config }, async (request, reply) => {
    const parsed = z
      .object({
        provider: z.enum(['TELEGRAM', 'BALE', 'RUBIKA']),
        token: z.string().min(10).max(200),
        title: z.string().max(190).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { bot, verified } = await BotService.create(request.currentUser!.id, parsed.data);
    return sendOk(reply, { bot: BotService.serializeBot(bot), verified }, 201);
  });

  app.get('/api/v1/bots/:id', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const bot = await BotService.get(request.currentUser!.id, params.data.id);
    return sendOk(reply, { bot: BotService.serializeBot(bot) });
  });

  app.patch('/api/v1/bots/:id', { preHandler: requireAuth, ...publishLimiter.config }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const parsed = z
      .object({
        title: z.string().min(1).max(190).optional(),
        commands: CommandsSchema.optional(),
        aiConfig: AiConfigSchema.optional(),
        token: z.string().min(10).max(200).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const bot = await BotService.update(request.currentUser!.id, params.data.id, parsed.data);
    return sendOk(reply, { bot: BotService.serializeBot(bot) });
  });

  app.delete('/api/v1/bots/:id', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    await BotService.delete(request.currentUser!.id, params.data.id);
    return sendOk(reply, { ok: true });
  });

  app.post('/api/v1/bots/:id/verify', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const bot = await BotService.verify(request.currentUser!.id, params.data.id);
    return sendOk(reply, { bot: BotService.serializeBot(bot) });
  });

  app.post('/api/v1/bots/:id/enable', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const bot = await BotService.enable(request.currentUser!.id, params.data.id);
    return sendOk(reply, { bot: BotService.serializeBot(bot) });
  });

  app.post('/api/v1/bots/:id/disable', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const bot = await BotService.disable(request.currentUser!.id, params.data.id);
    return sendOk(reply, { bot: BotService.serializeBot(bot) });
  });

  app.get('/api/v1/bots/:id/events', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const parsed = PaginationSchema.safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await BotService.listEvents(
      request.currentUser!.id,
      params.data.id,
      parsed.data.page,
      parsed.data.limit,
    );
    return sendOk(reply, { items, total, page: parsed.data.page, limit: parsed.data.limit });
  });

  app.get('/api/v1/bots/:id/users', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const parsed = PaginationSchema.safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await BotService.listBotUsers(
      request.currentUser!.id,
      params.data.id,
      parsed.data.page,
      parsed.data.limit,
    );
    return sendOk(reply, {
      items: items.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        externalUserId: u.externalUserId,
        firstSeenAt: u.firstSeenAt,
        lastSeenAt: u.lastSeenAt,
      })),
      total,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
  });

  /* ------------------------------ Provider webhooks ------------------------------ */

  app.post('/api/v1/webhooks/telegram/:botId', { config: { csrf: false }, ...webhookLimiter.config }, async (request, reply) => {
    const bot = await loadBotForWebhook((request.params as Record<string, string | undefined>)['botId']);
    const presented = readHeader(request, WEBHOOK_SECRET_HEADERS.telegram);
    if (bot === null || !BotService.secretMatches(bot, presented)) {
      return unauthorized(reply);
    }
    const result = await ingestBotUpdate(bot, request.body).catch((err: unknown) => {
      logger.error('telegram_webhook_ingest_failed', { botId: bot.id, error: err instanceof Error ? err.message : String(err) });
      return { inserted: false, botEventId: null };
    });
    return sendOk(reply, { ok: true, accepted: result.inserted });
  });

  app.post('/api/v1/webhooks/bale/:botId', { config: { csrf: false }, ...webhookLimiter.config }, async (request, reply) => {
    const bot = await loadBotForWebhook((request.params as Record<string, string | undefined>)['botId']);
    // Bale mirrors the Telegram header when configured through its webhook
    // params; the dedicated custom header is accepted as a fallback.
    const presented =
      readHeader(request, WEBHOOK_SECRET_HEADERS.telegram) ?? readHeader(request, WEBHOOK_SECRET_HEADERS.baleAlt);
    if (bot === null || !BotService.secretMatches(bot, presented)) {
      return unauthorized(reply);
    }
    const result = await ingestBotUpdate(bot, request.body).catch((err: unknown) => {
      logger.error('bale_webhook_ingest_failed', { botId: bot.id, error: err instanceof Error ? err.message : String(err) });
      return { inserted: false, botEventId: null };
    });
    return sendOk(reply, { ok: true, accepted: result.inserted });
  });

  app.post('/api/v1/webhooks/rubika/:botId', { config: { csrf: false }, ...webhookLimiter.config }, async (request, reply) => {
    void request;
    return reply.status(501).send({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'روبیکا از وب‌هوک پشتیبانی نمی‌کند؛ دریافت پیام‌ها با روش polling انجام می‌شود.',
        requestId: '',
      },
    });
  });
}
