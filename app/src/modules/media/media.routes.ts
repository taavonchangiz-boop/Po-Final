/**
 * Media routes: multipart upload (magic-byte checked), list/metadata and
 * authorized streaming.
 *
 * GET /media/:id/content is public ONLY for visibility=PUBLIC files.
 * PRIVATE files require a session; a non-owner (even an admin… admins may
 * read) gets 404 — never 403 — to avoid existence disclosure.
 */
import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendOk } from '../../core/envelope.js';
import { notFound, validationError } from '../../core/errors.js';
import { publishLimiter } from '../../security/rate-limit.js';
import { requireAuth } from '../../security/session.js';
import { MediaService } from './media.service.js';

function streamFile(reply: FastifyReply, absolutePath: string, mime: string, size: number): FastifyReply {
  reply.header('content-type', mime);
  reply.header('content-length', size);
  reply.header('cache-control', 'private, max-age=3600');
  return reply.send(createReadStream(absolutePath));
}

async function handleContent(request: FastifyRequest, reply: FastifyReply, mediaId: number): Promise<FastifyReply> {
  const row = await MediaService.getById(mediaId);
  if (row === null) throw notFound();

  if (row.visibility === 'PRIVATE') {
    // Authenticated owner/admin only. Everything else: 404 (no existence leak).
    await requireAuth(request);
    const user = request.currentUser;
    if (user === undefined) throw notFound();
    if (user.id !== row.userId && user.role === 'USER') throw notFound();
  }

  const absolutePath = MediaService.resolveStoredPath(row.storedPath);
  if (absolutePath === null) throw notFound();

  let size: number;
  try {
    size = await MediaService.fileSize(absolutePath);
  } catch {
    throw notFound();
  }
  return streamFile(reply, absolutePath, row.mime, size);
}

export function registerMediaRoutes(app: FastifyInstance): void {
  app.post('/api/v1/media', { preHandler: requireAuth, ...publishLimiter.config }, async (request, reply) => {
    const visibilityParsed = z
      .enum(['private', 'public'])
      .default('private')
      .safeParse((request.query as Record<string, unknown>)['visibility'] ?? 'private');

    const file = await request.file({ limits: { fileSize: MediaService.maxFileBytes, files: 1 } });
    if (file === undefined) throw validationError('فایلی ارسال نشده است.');

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of file.file) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike);
      total += buf.length;
      if (total > MediaService.maxFileBytes) {
        throw validationError('حجم فایل بیش از ۱۰ مگابایت است.');
      }
      chunks.push(buf);
    }
    const buffer = Buffer.concat(chunks);

    const row = await MediaService.save(request.currentUser!.id, {
      filename: file.filename ?? 'file',
      declaredMime: file.mimetype ?? 'application/octet-stream',
      buffer,
      visibility: visibilityParsed.success && visibilityParsed.data === 'public' ? 'PUBLIC' : 'PRIVATE',
    });

    return sendOk(
      reply,
      {
        id: row.id,
        originalName: row.originalName,
        mime: row.mime,
        size: row.size,
        width: row.width,
        height: row.height,
        visibility: row.visibility,
        createdAt: row.createdAt,
      },
      201,
    );
  });

  app.get('/api/v1/media', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await MediaService.list(request.currentUser!.id, parsed.data.page, parsed.data.limit);
    return sendOk(reply, { items, total, page: parsed.data.page, limit: parsed.data.limit });
  });

  app.get('/api/v1/media/:id', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const row = await MediaService.getById(parsed.data.id);
    if (row === null) throw notFound();
    const user = request.currentUser!;
    if (row.userId !== user.id && user.role === 'USER') throw notFound();
    return sendOk(reply, {
      id: row.id,
      originalName: row.originalName,
      mime: row.mime,
      size: row.size,
      width: row.width,
      height: row.height,
      sha256: row.sha256,
      visibility: row.visibility,
      createdAt: row.createdAt,
    });
  });

  /**
   * Content streaming. PUBLIC: no auth. PRIVATE: owner or admin only, and a
   * mismatch is a 404 (not 403) — no existence leak (task 4-b-2 media contract).
   */
  app.get('/api/v1/media/:id/content', async (request, reply) => {
    const parsed = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    return handleContent(request, reply, parsed.data.id);
  });
}
