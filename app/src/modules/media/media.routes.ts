import { FastifyInstance } from 'fastify';
import { AppError, ERR } from '../../core/errors.js';
import {
  uploadMedia, listMedia, deleteMedia, createMediaAccessToken, resolveMediaByToken, openMediaStream,
} from './media.service.js';

const ulidish = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

function parsePagination(query: unknown): { page: number; pageSize: number } {
  const raw = (query ?? {}) as Record<string, unknown>;
  const page = Number(raw['page'] ?? 1);
  const pageSize = Number(raw['pageSize'] ?? 20);
  return {
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100 ? pageSize : 20,
  };
}

function mustTenantId(req: { user?: { id: string } }): string {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return req.user.id;
}

function mustUlidParam(req: { params?: unknown }, name: string): string {
  const value = (req.params as Record<string, unknown>)[name];
  if (typeof value !== 'string' || !ulidish.test(value)) {
    throw new AppError(ERR.VALIDATION('شناسه معتبر نیست.'));
  }
  return value;
}

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  // Multipart upload via @fastify/multipart (registered in buildApp, 10MB stream cap).
  app.post('/media', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const file = await req.file();
    if (!file) throw new AppError(ERR.VALIDATION('فایلی ارسال نشده است.'));
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      throw new AppError(ERR.VALIDATION('حجم فایل بیش از حد مجاز است.'));
    }
    const media = await uploadMedia(tenantId, { buffer, mimeType: file.mimetype });
    return { success: true, data: { media } };
  });

  app.get('/media', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const { page, pageSize } = parsePagination(req.query);
    const result = await listMedia(tenantId, page, pageSize);
    return { success: true, data: result };
  });

  app.delete('/media/:id', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const id = mustUlidParam(req, 'id');
    await deleteMedia(tenantId, id);
    return { success: true, data: { deleted: true } };
  });

  // Creates a 15-min access token and returns the delivery URL.
  app.get('/media/:id/token', { preHandler: app.requireAuth }, async (req) => {
    const tenantId = mustTenantId(req);
    const id = mustUlidParam(req, 'id');
    const access = await createMediaAccessToken(tenantId, id);
    return { success: true, data: access };
  });

  // PUBLIC raw delivery (no auth): hash-validated, expiring token; used by the
  // delivery worker to hand providers a fetchable media URL. Private storage —
  // only this token-gated route exposes bytes.
  app.get('/media/raw/:id', async (req, reply) => {
    const id = mustUlidParamRaw((req.params as Record<string, unknown>)['id']);
    const token = (req.query as Record<string, unknown>)['token'];
    const row = await resolveMediaByToken(id, token);
    if (!row) throw new AppError(ERR.NOT_FOUND('فایل'));
    void reply.header('content-type', row.mime);
    void reply.header('content-length', Number(row.sizeBytes));
    void reply.header('cache-control', 'private, max-age=300');
    return reply.send(openMediaStream(row));
  });
}

function mustUlidParamRaw(value: unknown): string {
  if (typeof value !== 'string' || !ulidish.test(value)) throw new AppError(ERR.NOT_FOUND('فایل'));
  return value;
}
