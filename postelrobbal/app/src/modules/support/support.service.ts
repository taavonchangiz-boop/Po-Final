import { and, count, desc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { tickets, ticketMessages, ticketMessageAttachments } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';

export type ActorRole = 'SUPER_ADMIN' | 'SUPPORT' | 'USER';
export type TicketState = 'OPEN' | 'ANSWERED' | 'CLOSED';

export const TICKET_CATEGORIES: Array<{ key: string; labelFa: string }> = [
  { key: 'GENERAL', labelFa: 'عمومی' },
  { key: 'BILLING', labelFa: 'مالی و اشتراک' },
  { key: 'TECHNICAL', labelFa: 'فنی و ارسال' },
  { key: 'BOT', labelFa: 'ربات و پاسخگوی خودکار' },
  { key: 'FEATURE', labelFa: 'درخواست امکان جدید' },
];

export interface TicketListItem {
  id: string;
  subject: string;
  category: string;
  state: TicketState;
  createdAt: Date;
  updatedAt: Date;
}

export async function listTickets(
  tenantId: string,
  page: number,
  pageSize: number
): Promise<{ items: TicketListItem[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const [totalRow] = await db.select({ value: count() }).from(tickets).where(eq(tickets.tenantId, tenantId));
  const rows = await db
    .select()
    .from(tickets)
    .where(eq(tickets.tenantId, tenantId))
    .orderBy(desc(tickets.updatedAt))
    .limit(size)
    .offset((p - 1) * size);
  return { items: rows, total: Number(totalRow?.value ?? 0), page: p, pageSize: size };
}

/** Creates the ticket and its first message atomically. */
export async function createTicket(
  tenantId: string,
  authorId: string,
  input: { subject: string; category: string; body: string }
): Promise<{ id: string }> {
  const db = getDb();
  const known = TICKET_CATEGORIES.some((c) => c.key === input.category);
  const category = known ? input.category : 'GENERAL';
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(tickets).values({
      id,
      tenantId,
      subject: input.subject.trim().slice(0, 190),
      category,
      state: 'OPEN',
    });
    await tx.insert(ticketMessages).values({
      id: newId(),
      ticketId: id,
      authorId,
      authorRole: 'USER',
      body: input.body.trim(),
    });
  });
  return { id };
}

export interface TicketAttachmentDto {
  id: string;
  fileName: string;
  size: number;
  mime: string;
  url: string;
}

export interface TicketMessageDto {
  id: string;
  authorRole: string;
  authorId: string | null;
  body: string;
  createdAt: Date;
  attachment: TicketAttachmentDto | null;
}

function attachmentDto(row: {
  mediaId: string;
  fileName: string;
  sizeBytes: number | string;
  mime: string;
}): TicketAttachmentDto {
  return {
    id: row.mediaId,
    fileName: row.fileName,
    size: Number(row.sizeBytes),
    mime: row.mime,
    url: `/api/v1/media/${row.mediaId}`,
  };
}

/** Ownership enforced here; support roles may open any ticket. */
export async function getTicket(
  tenantId: string,
  ticketId: string,
  isSupport: boolean
): Promise<{ ticket: TicketListItem; messages: TicketMessageDto[] }> {
  const db = getDb();
  const where = isSupport ? eq(tickets.id, ticketId) : and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId));
  const [ticket] = await db.select().from(tickets).where(where).limit(1);
  // Not-found for both missing and foreign tickets — no existence leak (§180).
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));

  const messages = await db
    .select({
      id: ticketMessages.id,
      authorRole: ticketMessages.authorRole,
      authorId: ticketMessages.authorId,
      body: ticketMessages.body,
      createdAt: ticketMessages.createdAt,
      attMediaId: ticketMessageAttachments.mediaId,
      attFileName: ticketMessageAttachments.fileName,
      attSizeBytes: ticketMessageAttachments.sizeBytes,
      attMime: ticketMessageAttachments.mime,
    })
    .from(ticketMessages)
    .leftJoin(ticketMessageAttachments, eq(ticketMessageAttachments.messageId, ticketMessages.id))
    .where(eq(ticketMessages.ticketId, ticket.id))
    .orderBy(ticketMessages.createdAt)
    .limit(200);

  return {
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      state: ticket.state,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    },
    messages: messages.map((m) => ({
      id: m.id,
      authorRole: m.authorRole,
      authorId: m.authorId,
      body: m.body,
      createdAt: m.createdAt,
      attachment:
        m.attMediaId && m.attFileName && m.attMime !== null
          ? attachmentDto({ mediaId: m.attMediaId, fileName: m.attFileName, sizeBytes: m.attSizeBytes ?? 0, mime: m.attMime })
          : null,
    })),
  };
}

/**
 * Role-aware reply (§145): USER reply reopens the ticket (OPEN);
 * SUPPORT/SUPER_ADMIN reply marks it ANSWERED.
 * Optional attachment (contract 14-contract item 7): media is uploaded by the
 * route via media.service; the attachment row is written in the same
 * transaction as the message (one attachment per message — uq_tatt_message).
 */
export async function addTicketMessage(
  tenantId: string,
  ticketId: string,
  author: { id: string; role: ActorRole },
  body: string,
  attachment?: { mediaId: string; fileName: string; sizeBytes: number; mime: string }
): Promise<{ state: TicketState; message: TicketMessageDto }> {
  const db = getDb();
  const isSupport = author.role !== 'USER';
  const where = isSupport ? eq(tickets.id, ticketId) : and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId));
  const [ticket] = await db.select().from(tickets).where(where).limit(1);
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));
  if (ticket.state === 'CLOSED' && !isSupport) {
    throw new AppError(ERR.CONFLICT('این تیکت بسته شده است. برای ادامه، تیکت جدیدی بسازید.'));
  }

  const nextState: TicketState = isSupport ? 'ANSWERED' : 'OPEN';
  const messageId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(ticketMessages).values({
      id: messageId,
      ticketId: ticket.id,
      authorId: author.id,
      authorRole: author.role,
      body: body.trim().slice(0, 5000),
    });
    if (attachment) {
      await tx.insert(ticketMessageAttachments).values({
        id: newId(),
        messageId,
        mediaId: attachment.mediaId,
        fileName: attachment.fileName.slice(0, 255),
        sizeBytes: attachment.sizeBytes,
        mime: attachment.mime,
      });
    }
    await tx.update(tickets).set({ state: nextState }).where(eq(tickets.id, ticket.id));
  });

  const message: TicketMessageDto = {
    id: messageId,
    authorRole: author.role,
    authorId: author.id,
    body: body.trim().slice(0, 5000),
    createdAt: new Date(),
    attachment: attachment
      ? {
          id: attachment.mediaId,
          fileName: attachment.fileName.slice(0, 255),
          size: attachment.sizeBytes,
          mime: attachment.mime,
          url: `/api/v1/media/${attachment.mediaId}`,
        }
      : null,
  };
  return { state: nextState, message };
}

export async function closeTicket(
  tenantId: string,
  ticketId: string,
  actor: { id: string; role: ActorRole }
): Promise<void> {
  const db = getDb();
  const isSupport = actor.role !== 'USER';
  const where = isSupport ? eq(tickets.id, ticketId) : and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId));
  const [ticket] = await db.select().from(tickets).where(where).limit(1);
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));
  await db.update(tickets).set({ state: 'CLOSED' }).where(eq(tickets.id, ticket.id));
}
