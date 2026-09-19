import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import { getProvider } from '../../providers/index.js';
import type { Platform } from '../../providers/types.js';
import {
  listChannels, connectChannel, verifyChannel, disconnectChannel, updateChannel, ActorMeta,
} from './channel.service.js';

const PLATFORMS: readonly Platform[] = ['telegram', 'bale', 'rubika'];

function parsePlatform(value: unknown): Platform {
  if (typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)) {
    return value as Platform;
  }
  throw new AppError(ERR.VALIDATION('پلتفرم باید یکی از موارد telegram، bale یا rubika باشد.'));
}

function actor(req: FastifyRequest): ActorMeta & { tenantId: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { tenantId: req.user.id, actorId: req.user.id, actorRole: req.user.role, ip: req.ip };
}

const connectSchema = z.object({
  platform: z.enum(['telegram', 'bale', 'rubika']),
  channelRef: z.string().min(2).max(190),
  title: z.string().min(1).max(190),
  botId: z.string().min(10).max(26).optional(),
});

const updateSchema = z.object({ title: z.string().min(1).max(190) });

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

export async function registerChannelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/channels', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const channels = await listChannels(tenantId);
    return { success: true, data: { channels } };
  });

  app.post('/channels', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const input = parse(connectSchema, req.body);
    const channel = await connectChannel(tenantId, input, meta);
    return { success: true, data: { channel } };
  });

  // Static path before /channels/:id-style routes — capabilities for the UI.
  app.get('/channels/capabilities', { preHandler: [app.requireAuth] }, async (req) => {
    const query = (req.query ?? {}) as { platform?: unknown };
    const platform = parsePlatform(query.platform);
    return { success: true, data: { platform, capabilities: getProvider(platform).capabilities() } };
  });

  app.post('/channels/:id/verify', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const channel = await verifyChannel(tenantId, id, meta);
    return { success: true, data: { channel } };
  });

  app.post('/channels/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const input = parse(updateSchema, req.body);
    const channel = await updateChannel(tenantId, id, input, meta);
    return { success: true, data: { channel } };
  });

  app.delete('/channels/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const channel = await disconnectChannel(tenantId, id, meta);
    return { success: true, data: { channel } };
  });
}
