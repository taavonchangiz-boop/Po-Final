import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { roleHasPermission } from '../../security/permissions.js';
import { TICKET_CATEGORIES, listTickets, createTicket, getTicket, addTicketMessage, closeTicket, type ActorRole } from './support.service.js';
import { parseWith } from '../../core/validation.js';
import { uploadMedia } from '../media/media.service.js';

function auth(req: FastifyRequest): { id: string; role: ActorRole } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id, role: req.user.role };
}

const createTicketSchema = z.object({
  subject: z.string().min(3).max(190),
  category: z.string().min(1).max(80).optional(),
  body: z.string().min(5).max(5000),
});

const messageSchema = z.object({
  body: z.string().min(1).max(5000),
});

// Ticket attachments (contract 14-contract item 7): images the media service
// can magic-byte-verify, plus PDF. ≤10MB (matches the multipart stream cap).
const ATTACHMENT_MIME_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

export async function registerSupportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/support/tickets', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const q = (req.query ?? {}) as { page?: string; pageSize?: string };
    const page = Number.parseInt(q.page ?? '1', 10) || 1;
    const pageSize = Number.parseInt(q.pageSize ?? '20', 10) || 20;
    const data = await listTickets(me.id, page, pageSize);
    return {
      success: true,
      data: { ...data, categories: TICKET_CATEGORIES },
    };
  });

  app.post('/support/tickets', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const input = parse(createTicketSchema, req.body);
    const data = await createTicket(me.id, me.id, {
      subject: input.subject,
      category: input.category ?? 'GENERAL',
      body: input.body,
    });
    return { success: true, data };
  });

  app.get('/support/tickets/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const { id } = req.params as { id: string };
    const isSupport = roleHasPermission(me.role, 'support.tickets.any');
    const data = await getTicket(me.id, id, isSupport);
    return { success: true, data };
  });

  app.post('/support/tickets/:id/messages', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const { id } = req.params as { id: string };

    // Multipart: "body" text field + optional "file" (image/*|pdf ≤10MB).
    // JSON {body} stays accepted so the current page keeps working until the
    // frontend upgrade ships.
    let body: string | null = null;
    let file: { buffer: Buffer; mime: string; fileName: string } | null = null;
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (file) continue; // stream cap allows one file — defensive
          const mime = part.mimetype.toLowerCase();
          if (!ATTACHMENT_MIME_ALLOWED.has(mime)) {
            throw new AppError(ERR.VALIDATION('فرمت فایل مجاز نیست. تصویر (JPG، PNG، WebP، GIF) یا PDF ارسال کنید.'));
          }
          let buffer: Buffer;
          try {
            buffer = await part.toBuffer();
          } catch {
            throw new AppError(ERR.VALIDATION('حجم فایل بیش از حد مجاز است.'));
          }
          const fileName = (part.filename ?? 'file').trim().slice(0, 255) || 'file';
          file = { buffer, mime, fileName };
        } else if (part.fieldname === 'body' && typeof part.value === 'string') {
          body = part.value;
        }
      }
      if (body === null || body.trim().length === 0) {
        throw new AppError(ERR.VALIDATION('متن پیام را وارد کنید.'));
      }
    } else {
      const input = parse(messageSchema, req.body);
      body = input.body;
    }

    let attachment: { mediaId: string; fileName: string; sizeBytes: number; mime: string } | undefined;
    if (file) {
      // uploadMedia re-validates size (≤10MB here) + magic bytes and stores
      // the bytes in the author's private tenant folder.
      const uploaded = await uploadMedia(me.id, {
        buffer: file.buffer,
        mimeType: file.mime,
        maxBytes: ATTACHMENT_MAX_BYTES,
      });
      attachment = { mediaId: uploaded.id, fileName: file.fileName, sizeBytes: uploaded.sizeBytes, mime: uploaded.mime };
    }

    const author = { id: me.id, role: me.role };
    const data = await addTicketMessage(me.id, id, author, body, attachment);
    return { success: true, data };
  });

  app.post('/support/tickets/:id/close', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const { id } = req.params as { id: string };
    const actor = { id: me.id, role: me.role };
    await closeTicket(me.id, id, actor);
    return { success: true, data: { ok: true } };
  });
}
