/**
 * Support routes: user-facing tickets (list/create/thread/reply) with file
 * attachments (task 10-d) + authorized attachment download.
 * Staff-side management lives in the admin module.
 *
 * Attachments:
 *  - Ticket creation and replies accept `multipart/form-data` with the usual
 *    text fields plus ONE optional file part named `attachment`
 *    (image/jpeg | image/png | image/webp | image/gif | application/pdf, ≤5MB,
 *    magic-byte checked, stored through the media module pipeline as PRIVATE).
 *  - JSON bodies keep working (no attachment).
 *  - GET /support/attachments/:id streams a ticket attachment to the ticket
 *    owner or staff — anyone else gets 404 (no existence disclosure).
 */
import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { sendCreated, sendOk } from '../../core/envelope.js';
import { notFound, validationError } from '../../core/errors.js';
import { publishLimiter } from '../../security/rate-limit.js';
import { requireAuth } from '../../security/session.js';
import { db } from '../../db/client.js';
import { supportTickets, ticketMessages } from '../../db/schema.js';
import { MediaService, TICKET_ATTACHMENT_MAX_BYTES } from '../media/media.service.js';
import { SUPPORT_CATEGORIES, SupportService } from './support.service.js';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const TicketCreateSchema = z.object({
  subject: z.string().min(3).max(190),
  category: z.string().min(2).max(40).default('GENERAL'),
  body: z.string().min(10).max(5000),
  attachmentId: z.coerce.number().int().min(1).optional(),
});

const TicketReplySchema = z.object({
  body: z.string().min(1).max(5000),
  attachmentId: z.coerce.number().int().min(1).optional(),
});

interface MultipartPayload {
  fields: Record<string, string>;
  file: { filename: string; mimetype: string; buffer: Buffer } | null;
}

/** Stream-read a multipart request: text fields + at most one file (≤5MB). */
async function readMultipart(request: FastifyRequest): Promise<MultipartPayload> {
  const fields: Record<string, string> = {};
  let file: MultipartPayload['file'] = null;

  for await (const part of request.parts({ limits: { fileSize: TICKET_ATTACHMENT_MAX_BYTES, files: 5, fields: 20 } })) {
    if (part.type === 'file') {
      if (file !== null) {
        // Drain any extra file part, then reject with a clear message.
        for await (const _chunk of part.file) void _chunk; // eslint-disable-line @typescript-eslint/no-unused-vars
        throw validationError('در هر درخواست فقط یک فایل پیوست پذیرفته می‌شود.');
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of part.file) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike);
        total += buf.length;
        if (total > TICKET_ATTACHMENT_MAX_BYTES) {
          throw validationError('حجم فایل پیوست بیش از ۵ مگابایت است.');
        }
        chunks.push(buf);
      }
      file = {
        filename: part.filename || 'file',
        mimetype: part.mimetype || 'application/octet-stream',
        buffer: Buffer.concat(chunks),
      };
    } else {
      fields[part.fieldname] = typeof part.value === 'string' ? part.value : String(part.value ?? '');
    }
  }

  return { fields, file };
}

/** Map the busboy size-limit error to the Persian validation message. */
function isRequestFileTooLarge(request: FastifyRequest, err: unknown): boolean {
  const TooLarge = request.server.multipartErrors.RequestFileTooLargeError;
  return err instanceof TooLarge;
}

export function registerSupportRoutes(app: FastifyInstance): void {
  app.get('/api/v1/support/tickets', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = PaginationSchema.safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await SupportService.listTickets(request.currentUser!.id, parsed.data.page, parsed.data.limit);
    return sendOk(reply, { items, total, page: parsed.data.page, limit: parsed.data.limit });
  });

  app.post(
    '/api/v1/support/tickets',
    { preHandler: requireAuth, ...publishLimiter.config },
    async (request, reply) => {
      let parsed;
      if (request.isMultipart()) {
        try {
          const { fields, file } = await readMultipart(request);
          parsed = TicketCreateSchema.safeParse(fields);
          if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
          if (file !== null && file.buffer.length > 0) {
            const mediaRow = await MediaService.saveTicketAttachment(request.currentUser!.id, {
              filename: file.filename,
              declaredMime: file.mimetype,
              buffer: file.buffer,
            });
            parsed.data.attachmentId = mediaRow.id;
          }
        } catch (err) {
          if (isRequestFileTooLarge(request, err)) {
            throw validationError('حجم فایل پیوست بیش از ۵ مگابایت است.');
          }
          throw err;
        }
      } else {
        parsed = TicketCreateSchema.safeParse(request.body);
        if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
      }

      const category = (SUPPORT_CATEGORIES as readonly string[]).includes(parsed.data.category.toUpperCase())
        ? parsed.data.category.toUpperCase()
        : 'GENERAL';

      const ticket = await SupportService.createTicket(request.currentUser!.id, {
        subject: parsed.data.subject,
        category,
        body: parsed.data.body,
        attachmentId: parsed.data.attachmentId ?? null,
      });
      return sendCreated(reply, { ticket });
    },
  );

  app.get('/api/v1/support/tickets/:id', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const thread = await SupportService.getThread(request.currentUser!.id, parsed.data.id);
    return sendOk(reply, thread);
  });

  app.post(
    '/api/v1/support/tickets/:id/messages',
    { preHandler: requireAuth, ...publishLimiter.config },
    async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
      if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());

      let parsed;
      if (request.isMultipart()) {
        try {
          const { fields, file } = await readMultipart(request);
          parsed = TicketReplySchema.safeParse(fields);
          if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
          if (file !== null && file.buffer.length > 0) {
            const mediaRow = await MediaService.saveTicketAttachment(request.currentUser!.id, {
              filename: file.filename,
              declaredMime: file.mimetype,
              buffer: file.buffer,
            });
            parsed.data.attachmentId = mediaRow.id;
          }
        } catch (err) {
          if (isRequestFileTooLarge(request, err)) {
            throw validationError('حجم فایل پیوست بیش از ۵ مگابایت است.');
          }
          throw err;
        }
      } else {
        parsed = TicketReplySchema.safeParse(request.body);
        if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
      }

      const result = await SupportService.addMessage(
        {
          ticketId: params.data.id,
          senderUserId: request.currentUser!.id,
          isStaff: false,
          body: parsed.data.body,
          attachmentId: parsed.data.attachmentId ?? null,
        },
        request.currentUser!.id,
      );
      return sendCreated(reply, { ticket: result.ticket, message: result.message });
    },
  );

  /**
   * Authorized attachment download (task 10-d). Access = ticket owner or staff
   * (ADMIN/SUPER_ADMIN). Everyone else — including authenticated users who are
   * unrelated to the ticket — gets a uniform 404 (no existence disclosure).
   */
  app.get('/api/v1/support/attachments/:id', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const attachmentId = params.data.id;

    const messageRows = await db
      .select({ ticketId: ticketMessages.ticketId })
      .from(ticketMessages)
      .where(eq(ticketMessages.attachmentId, attachmentId))
      .limit(1);
    const message = messageRows[0];
    if (!message) throw notFound('فایل پیوست یافت نشد.');

    const ticketRows = await db
      .select({ userId: supportTickets.userId })
      .from(supportTickets)
      .where(eq(supportTickets.id, message.ticketId))
      .limit(1);
    const ticket = ticketRows[0];
    if (!ticket) throw notFound('فایل پیوست یافت نشد.');

    const user = request.currentUser!;
    if (user.id !== ticket.userId && user.role === 'USER') throw notFound('فایل پیوست یافت نشد.');

    const mediaRow = await MediaService.getById(attachmentId);
    if (mediaRow === null) throw notFound('فایل پیوست یافت نشد.');
    const absolutePath = MediaService.resolveStoredPath(mediaRow.storedPath);
    if (absolutePath === null) throw notFound('فایل پیوست یافت نشد.');

    let size: number;
    try {
      size = await MediaService.fileSize(absolutePath);
    } catch {
      throw notFound('فایل پیوست یافت نشد.');
    }

    reply.header('content-type', mediaRow.mime);
    reply.header('content-length', size);
    reply.header(
      'content-disposition',
      `inline; filename="attachment-${mediaRow.id}"; filename*=UTF-8''${encodeURIComponent(mediaRow.originalName)}`,
    );
    reply.header('cache-control', 'private, no-store');
    return reply.send(createReadStream(absolutePath));
  });
}
