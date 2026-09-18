/**
 * Gold routes (api-contract §Gold). All authenticated + owner-scoped:
 *  GET  /api/v1/gold/prices            — latest price per asset (own tenant)
 *  POST /api/v1/gold/prices            — manual price entry {asset, price}
 *  GET  /api/v1/gold/configs           — own configs (joined channel title/provider)
 *  PUT  /api/v1/gold/configs/:channelId — upsert config (assets/frequency/...)
 *  POST /api/v1/gold/publish           — manual publish now (idempotent per day)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendCreated, sendOk } from '../../core/envelope.js';
import { publishLimiter } from '../../security/rate-limit.js';
import { requireAuth } from '../../security/session.js';
import { requireUser } from '../../security/current-user.js';
import { listConfigs, listLatestPrices, publishGoldNow, recordPrice, upsertConfig, GOLD_ASSETS, type GoldConfigRow } from './gold.service.js';

const goldAssetSchema = z.enum(GOLD_ASSETS);

const recordPriceSchema = z
  .object({
    asset: goldAssetSchema,
    price: z.coerce.number().int().positive('قیمت باید بزرگ‌تر از صفر باشد.'),
  })
  .strict();

const frequencySchema = z.enum(['MANUAL', 'HOURLY', 'DAILY', 'WEEKLY']);
const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const upsertConfigSchema = z
  .object({
    assets: z.array(goldAssetSchema).min(1, 'حداقل یک دارایی لازم است.').max(8),
    frequency: frequencySchema,
    timeOfDay: z.string().regex(TIME_OF_DAY_RE, 'ساعت باید با قالب HH:mm باشد.').optional(),
    timezone: z.string().min(1).max(64).default('Asia/Tehran'),
    template: z.string().max(2000, 'قالب پیام حداکثر ۲۰۰۰ کاراکتر است.').optional(),
    isEnabled: z.boolean(),
  })
  .strict();

const channelIdParamSchema = z.object({ channelId: z.coerce.number().int().positive() });

const publishSchema = z
  .object({
    channelId: z.coerce.number().int().positive(),
  })
  .strict();

function serializeConfig(row: GoldConfigRow): Record<string, unknown> {
  return {
    id: row.id,
    channelId: row.channelId,
    assets: row.assets,
    frequency: row.frequency,
    timeOfDay: row.timeOfDay,
    timezone: row.timezone,
    template: row.template,
    isEnabled: row.isEnabled,
    lastSentAt: row.lastSentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function registerGoldRoutes(app: FastifyInstance): void {
  /* --------------------------------- prices -------------------------------- */

  app.get('/api/v1/gold/prices', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const prices = await listLatestPrices(user.id);
    return sendOk(reply, { items: prices });
  });

  app.post('/api/v1/gold/prices', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const input = recordPriceSchema.parse(request.body);
    const row = await recordPrice(user.id, input);
    return sendCreated(reply, {
      id: row.id,
      asset: row.asset,
      price: row.price,
      source: row.source,
      recordedAt: row.recordedAt,
    });
  });

  /* --------------------------------- configs -------------------------------- */

  app.get('/api/v1/gold/configs', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const items = await listConfigs(user.id);
    return sendOk(reply, { items });
  });

  app.put('/api/v1/gold/configs/:channelId', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const params = channelIdParamSchema.parse(request.params);
    const input = upsertConfigSchema.parse(request.body);
    const row = await upsertConfig(user.id, params.channelId, input);
    return sendOk(reply, serializeConfig(row));
  });

  /* ------------------------------ manual publish ----------------------------- */

  app.post('/api/v1/gold/publish', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const input = publishSchema.parse(request.body);
    const result = await publishGoldNow(user.id, input.channelId);
    return sendOk(reply, result);
  });
}
