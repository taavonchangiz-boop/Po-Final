import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import {
  listBots, connectBot, verifyBot, enableBot, disableBot, setBotMode, updateAiSettings,
  listBotUsers, getBotStats, getBotCapabilities, ingestBotWebhook,
  listBotCommands, createBotCommand, updateBotCommand, deleteBotCommand,
  listBotKeywords, createBotKeyword, updateBotKeyword, deleteBotKeyword,
  type BotResponsePayload,
} from './bot.service.js';

const ulidish = z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, 'شناسه معتبر نیست.');

const connectSchema = z.object({
  platform: z.enum(['telegram', 'bale', 'rubika']),
  token: z.string().min(10).max(256),
  title: z.string().min(1).max(190).optional(),
});
const modeSchema = z.object({ mode: z.enum(['WEBHOOK', 'POLLING']) });
const aiSettingsSchema = z.object({
  aiEnabled: z.boolean(),
  aiSystemPrompt: z.string().max(4000).nullable().optional(),
});
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const responsePayloadSchema = z
  .object({
    text: z.string().max(4000).optional(),
    buttons: z
      .array(
        z.object({
          label: z.string().min(1).max(64),
          url: z.string().url().max(255).optional(),
          callback: z.string().max(64).optional(),
        })
      )
      .max(8)
      .optional(),
    systemPrompt: z.string().max(4000).optional(),
    workflowId: ulidish.optional(),
  })
  .strict();

const commandCreateSchema = z.object({
  command: z.string().min(2).max(64),
  descriptionFa: z.string().max(190).optional(),
  responseKind: z.enum(['TEXT', 'BUTTONS', 'AI', 'WORKFLOW']).default('TEXT'),
  responsePayload: responsePayloadSchema.nullable().optional(),
});
const commandUpdateSchema = z.object({
  command: z.string().min(2).max(64).optional(),
  descriptionFa: z.string().max(190).optional(),
  responseKind: z.enum(['TEXT', 'BUTTONS', 'AI', 'WORKFLOW']).optional(),
  responsePayload: responsePayloadSchema.nullable().optional(),
  isEnabled: z.boolean().optional(),
});

const keywordCreateSchema = z.object({
  keyword: z.string().min(2).max(190),
  matchKind: z.enum(['EXACT', 'CONTAINS']).default('CONTAINS'),
  responseKind: z.enum(['TEXT', 'BUTTONS', 'AI', 'WORKFLOW']).default('TEXT'),
  responsePayload: responsePayloadSchema.nullable().optional(),
});
const keywordUpdateSchema = z.object({
  keyword: z.string().min(2).max(190).optional(),
  matchKind: z.enum(['EXACT', 'CONTAINS']).optional(),
  responseKind: z.enum(['TEXT', 'BUTTONS', 'AI', 'WORKFLOW']).optional(),
  responsePayload: responsePayloadSchema.nullable().optional(),
  isEnabled: z.boolean().optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

function parseParam<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  return parse(schema, value);
}

function asPayload(v: z.infer<typeof responsePayloadSchema> | null | undefined): BotResponsePayload | null {
  if (!v) return null;
  return {
    ...(v.text !== undefined ? { text: v.text } : {}),
    ...(v.buttons !== undefined ? { buttons: v.buttons } : {}),
    ...(v.systemPrompt !== undefined ? { systemPrompt: v.systemPrompt } : {}),
    ...(v.workflowId !== undefined ? { workflowId: v.workflowId } : {}),
  };
}

export async function registerBotRoutes(app: FastifyInstance): Promise<void> {
  // ---- bots CRUD-ish lifecycle ----

  app.post('/bots', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const input = parse(connectSchema, req.body);
    const bot = await connectBot(user.id, input);
    return { success: true, data: { bot } };
  });

  app.get('/bots', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const items = await listBots(user.id);
    return { success: true, data: { items } };
  });

  app.post('/bots/:id/verify', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const result = await verifyBot(user.id, id);
    return { success: true, data: result };
  });

  app.post('/bots/:id/enable', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const bot = await enableBot(user.id, id);
    return { success: true, data: { bot } };
  });

  app.post('/bots/:id/disable', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const bot = await disableBot(user.id, id);
    return { success: true, data: { bot } };
  });

  app.post('/bots/:id/mode', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const { mode } = parse(modeSchema, req.body);
    const bot = await setBotMode(user.id, id, mode);
    return { success: true, data: { bot } };
  });

  app.put('/bots/:id/ai', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const input = parse(aiSettingsSchema, req.body);
    const bot = await updateAiSettings(user.id, id, input);
    return { success: true, data: { bot } };
  });

  app.get('/bots/:id/users', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const q = parse(paginationQuery, req.query);
    const result = await listBotUsers(user.id, id, q.page, q.pageSize);
    return { success: true, data: result };
  });

  app.get('/bots/:id/stats', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const stats = await getBotStats(user.id, id);
    return { success: true, data: stats };
  });

  // UI uses this to disable unsupported actions (§16 — never emulate).
  app.get('/bots/:id/capabilities', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const capabilities = await getBotCapabilities(user.id, id);
    return { success: true, data: { capabilities } };
  });

  // ---- commands ----

  app.get('/bots/:id/commands', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const items = await listBotCommands(user.id, id);
    return { success: true, data: { items } };
  });

  app.post('/bots/:id/commands', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const input = parse(commandCreateSchema, req.body);
    const command = await createBotCommand(user.id, id, {
      command: input.command,
      descriptionFa: input.descriptionFa,
      responseKind: input.responseKind,
      responsePayload: asPayload(input.responsePayload),
    });
    return { success: true, data: { command } };
  });

  app.put('/bots/:id/commands', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const body = parse(commandUpdateSchema.extend({ commandId: ulidish }), req.body);
    const command = await updateBotCommand(user.id, body.commandId, {
      command: body.command,
      descriptionFa: body.descriptionFa,
      responseKind: body.responseKind,
      responsePayload: body.responsePayload === undefined ? undefined : asPayload(body.responsePayload),
      isEnabled: body.isEnabled,
    });
    return { success: true, data: { command } };
  });

  app.delete('/bots/:id/commands', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const commandId = parseParam(ulidish, (req.query as Record<string, unknown>).commandId);
    await deleteBotCommand(user.id, commandId);
    return { success: true, data: { deleted: true } };
  });

  app.put('/bots/commands/:cmdId', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const cmdId = parseParam(ulidish, (req.params as Record<string, unknown>).cmdId);
    const input = parse(commandUpdateSchema, req.body);
    const command = await updateBotCommand(user.id, cmdId, {
      command: input.command,
      descriptionFa: input.descriptionFa,
      responseKind: input.responseKind,
      responsePayload: input.responsePayload === undefined ? undefined : asPayload(input.responsePayload),
      isEnabled: input.isEnabled,
    });
    return { success: true, data: { command } };
  });

  app.delete('/bots/commands/:cmdId', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const cmdId = parseParam(ulidish, (req.params as Record<string, unknown>).cmdId);
    await deleteBotCommand(user.id, cmdId);
    return { success: true, data: { deleted: true } };
  });

  // ---- keywords ----

  app.get('/bots/:id/keywords', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const items = await listBotKeywords(user.id, id);
    return { success: true, data: { items } };
  });

  app.post('/bots/:id/keywords', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const id = parseParam(ulidish, (req.params as Record<string, unknown>).id);
    const input = parse(keywordCreateSchema, req.body);
    const keyword = await createBotKeyword(user.id, id, {
      keyword: input.keyword,
      matchKind: input.matchKind,
      responseKind: input.responseKind,
      responsePayload: asPayload(input.responsePayload),
    });
    return { success: true, data: { keyword } };
  });

  app.put('/bots/keywords/:kwId', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const kwId = parseParam(ulidish, (req.params as Record<string, unknown>).kwId);
    const input = parse(keywordUpdateSchema, req.body);
    const keyword = await updateBotKeyword(user.id, kwId, {
      keyword: input.keyword,
      matchKind: input.matchKind,
      responseKind: input.responseKind,
      responsePayload: input.responsePayload === undefined ? undefined : asPayload(input.responsePayload),
      isEnabled: input.isEnabled,
    });
    return { success: true, data: { keyword } };
  });

  app.delete('/bots/keywords/:kwId', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (!user) throw new AppError(ERR.AUTH_REQUIRED());
    const kwId = parseParam(ulidish, (req.params as Record<string, unknown>).kwId);
    await deleteBotKeyword(user.id, kwId);
    return { success: true, data: { deleted: true } };
  });

  // ---- PUBLIC provider webhook (no auth; CSRF-exempt via buildApp skip on /api/v1/webhooks) ----

  app.post(
    '/webhooks/bots/:botId',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req) => {
      const botId = (req.params as Record<string, unknown>).botId;
      if (typeof botId !== 'string' || !ulidish.safeParse(botId).success) {
        return { success: true }; // never leak validity to the provider
      }
      const secret = (req.query as Record<string, unknown>)['s'];
      try {
        await ingestBotWebhook(botId, secret, req.body);
      } catch {
        // swallow — never leak errors to the provider (§187)
      }
      return { success: true };
    }
  );
}
