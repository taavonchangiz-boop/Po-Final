/**
 * Support service: tickets + threaded messages with owner-safe access and
 * status flip semantics (user reply → OPEN, staff reply → ANSWERED).
 */
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { notFound, validationError } from '../../core/errors.js';
import { AnalyticsService } from '../../core/events.js';
import { db } from '../../db/client.js';
import { media, supportTickets, ticketMessages } from '../../db/schema.js';

export type TicketRow = typeof supportTickets.$inferSelect;
export type TicketMessageRow = typeof ticketMessages.$inferSelect;

export interface TicketAttachmentMeta {
  id: number;
  originalName: string;
  mime: string;
  size: number;
}

export const SUPPORT_CATEGORIES = ['GENERAL', 'BILLING', 'TECHNICAL', 'FEATURE'] as const;

/** Join attachment metadata (id/name/mime/size) onto message rows. Shared with the admin thread endpoint. */
export async function attachAttachmentMeta(
  messageRows: TicketMessageRow[],
): Promise<Array<TicketMessageRow & { attachment: TicketAttachmentMeta | null }>> {
  const attachmentIds = messageRows
    .map((m) => m.attachmentId)
    .filter((id): id is number => id !== null);

  const attachments = new Map<number, TicketAttachmentMeta>();
  if (attachmentIds.length > 0) {
    const rows = await db
      .select({ id: media.id, originalName: media.originalName, mime: media.mime, size: media.size })
      .from(media)
      .where(inArray(media.id, attachmentIds));
    for (const row of rows) attachments.set(row.id, row);
  }

  return messageRows.map((m) => ({
    ...m,
    attachment: m.attachmentId !== null ? (attachments.get(m.attachmentId) ?? null) : null,
  }));
}

/**
 * Validate an attachmentId before binding it to a ticket message: the media row
 * must exist and belong to the sender (users may only attach their own uploads;
 * staff attachments only need to exist). Returns the validated id or null.
 */
async function validateAttachmentId(
  attachmentId: number | null | undefined,
  senderUserId: number | null,
): Promise<number | null> {
  if (attachmentId === null || attachmentId === undefined) return null;
  const rows = await db
    .select({ id: media.id, userId: media.userId })
    .from(media)
    .where(eq(media.id, attachmentId))
    .limit(1);
  const row = rows[0];
  if (!row) throw validationError('فایل پیوست یافت نشد؛ دوباره آپلود کنید.');
  if (senderUserId !== null && row.userId !== senderUserId) {
    throw validationError('فایل پیوست معتبر نیست.');
  }
  return row.id;
}

export const SupportService = {
  async createTicket(
    userId: number,
    input: { subject: string; category: string; body: string; attachmentId?: number | null },
  ): Promise<TicketRow> {
    const attachmentId = await validateAttachmentId(input.attachmentId, userId);
    const inserted = await db
      .insert(supportTickets)
      .values({
        userId,
        subject: input.subject.slice(0, 190),
        category: input.category.slice(0, 40).toUpperCase(),
        status: 'OPEN',
      })
      .$returningId();
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error('ticket_insert_failed');

    await db.insert(ticketMessages).values({
      ticketId: Number(id),
      senderUserId: userId,
      isStaff: false,
      body: input.body.slice(0, 5000),
      attachmentId,
    });

    AnalyticsService.trackEvent({
      userId,
      type: 'support.ticket.created',
      subjectType: 'ticket',
      subjectId: Number(id),
      data: { category: input.category },
    });

    const rows = await db.select().from(supportTickets).where(eq(supportTickets.id, Number(id))).limit(1);
    const row = rows[0];
    if (!row) throw new Error('ticket_missing');
    return row;
  },

  async listTickets(userId: number, page: number, limit: number): Promise<{ items: TicketRow[]; total: number }> {
    const [items, totalRows] = await Promise.all([
      db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.userId, userId))
        .orderBy(desc(supportTickets.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(supportTickets).where(eq(supportTickets.userId, userId)),
    ]);
    return { items, total: Number(totalRows[0]?.value ?? 0) };
  },

  /** Thread (messages ascending) + attachment metadata; owner-safe. */
  async getThread(
    userId: number,
    ticketId: number,
  ): Promise<{ ticket: TicketRow; messages: Array<TicketMessageRow & { attachment: TicketAttachmentMeta | null }> }> {
    const ticketRows = await db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)))
      .limit(1);
    const ticket = ticketRows[0];
    if (!ticket) throw notFound('تیکت یافت نشد.');

    const messageRows = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticket.id))
      .orderBy(asc(ticketMessages.id))
      .limit(500);

    return { ticket, messages: await attachAttachmentMeta(messageRows) };
  },

  /** User (or staff) reply with the status flip semantics. */
  async addMessage(
    opts: {
      ticketId: number;
      senderUserId: number | null;
      isStaff: boolean;
      body: string;
      attachmentId?: number | null;
    },
    ownerId?: number,
  ): Promise<{ ticket: TicketRow; message: TicketMessageRow }> {
    const ticketRows = await db.select().from(supportTickets).where(eq(supportTickets.id, opts.ticketId)).limit(1);
    const ticket = ticketRows[0];
    if (!ticket) throw notFound('تیکت یافت نشد.');
    if (!opts.isStaff && (ownerId === undefined || ticket.userId !== ownerId)) {
      throw notFound('تیکت یافت نشد.');
    }
    if (ticket.status === 'CLOSED') {
      throw notFound('تیکت یافت نشد.');
    }

    // Users may only attach files they uploaded themselves; staff attachments
    // only need to exist (senderUserId is the staff account then).
    const attachmentOwner = opts.isStaff ? null : (ownerId ?? opts.senderUserId);
    const attachmentId = await validateAttachmentId(opts.attachmentId, attachmentOwner);

    const inserted = await db
      .insert(ticketMessages)
      .values({
        ticketId: ticket.id,
        senderUserId: opts.senderUserId,
        isStaff: opts.isStaff,
        body: opts.body.slice(0, 5000),
        attachmentId,
      })
      .$returningId();
    const messageId = inserted[0]?.id;
    if (messageId === undefined) throw new Error('ticket_message_insert_failed');

    const nextStatus: TicketRow['status'] = opts.isStaff ? 'ANSWERED' : 'OPEN';
    await db
      .update(supportTickets)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(supportTickets.id, ticket.id));

    AnalyticsService.trackEvent({
      userId: opts.senderUserId ?? ticket.userId,
      type: 'support.ticket.replied',
      subjectType: 'ticket',
      subjectId: ticket.id,
      data: { isStaff: opts.isStaff },
    });

    const messageRows = await db.select().from(ticketMessages).where(eq(ticketMessages.id, Number(messageId))).limit(1);
    const message = messageRows[0];
    if (!message) throw new Error('ticket_message_missing');

    const updated = await db.select().from(supportTickets).where(eq(supportTickets.id, ticket.id)).limit(1);
    const updatedTicket = updated[0];
    if (!updatedTicket) throw new Error('ticket_missing');

    return { ticket: updatedTicket, message };
  },
};
