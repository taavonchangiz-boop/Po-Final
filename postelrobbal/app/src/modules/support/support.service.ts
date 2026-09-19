import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { tickets, ticketMessages, ticketMessageAttachments, users } from '../../db/schema.js';
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

/** Shared message mapping (user path + admin 360 path) — identical shape. */
async function fetchTicketMessages(ticketId: string): Promise<TicketMessageDto[]> {
  const db = getDb();
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
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(ticketMessages.createdAt)
    .limit(200);

  return messages.map((m) => ({
    id: m.id,
    authorRole: m.authorRole,
    authorId: m.authorId,
    body: m.body,
    createdAt: m.createdAt,
    attachment:
      m.attMediaId && m.attFileName && m.attMime !== null
        ? attachmentDto({ mediaId: m.attMediaId, fileName: m.attFileName, sizeBytes: m.attSizeBytes ?? 0, mime: m.attMime })
        : null,
  }));
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

  return {
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      state: ticket.state,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    },
    messages: await fetchTicketMessages(ticket.id),
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

// ---------------------------------------------------------------------------
// Round 18 — admin-side ticket management (asovin «تیکت‌های پشتیبانی» parity).
// User-path functions above are untouched; these run without tenant scope.
// ---------------------------------------------------------------------------

export type AdminTicketState = 'OPEN' | 'ANSWERED' | 'CLOSED';

export interface AdminTicketListItem {
  id: string;
  subject: string;
  category: string;
  state: TicketState;
  createdAt: Date;
  updatedAt: Date;
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
  messageCount: number;
  lastMessageAt: Date | null;
}

const toDate = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const tenantNameOf = (firstName: string | null, lastName: string | null): string =>
  `${firstName ?? ''} ${lastName ?? ''}`.trim();

/** Admin ticket list: tenant join, search across subject/tenant, one grouped
 *  message-count query for the page ids (no N+1). Ordered by updatedAt desc. */
export async function adminListTickets(opts: {
  state?: AdminTicketState;
  search?: string;
  page: number;
  pageSize: number;
}): Promise<{ items: AdminTicketListItem[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, opts.page);
  const size = Math.min(100, Math.max(1, opts.pageSize));
  const term = opts.search?.trim();
  const like = term ? `%${term.replace(/[%_]/g, '')}%` : null;
  const where = and(
    opts.state ? eq(tickets.state, opts.state) : undefined,
    like
      ? or(
          sql`${tickets.subject} LIKE ${like}`,
          sql`${users.email} LIKE ${like}`,
          sql`${users.firstName} LIKE ${like}`,
          sql`${users.lastName} LIKE ${like}`
        )
      : undefined
  );

  const [totalRow] = await db
    .select({ value: count() })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.tenantId))
    .where(where);
  const rows = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      category: tickets.category,
      state: tickets.state,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      tenantId: tickets.tenantId,
      tenantFirstName: users.firstName,
      tenantLastName: users.lastName,
      tenantEmail: users.email,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.tenantId))
    .where(where)
    .orderBy(desc(tickets.updatedAt))
    .limit(size)
    .offset((p - 1) * size);

  // One grouped query for the page's ticket ids: COUNT + MAX(created_at).
  const ids = rows.map((r) => r.id);
  const msgRows = ids.length
    ? await db
        .select({
          ticketId: ticketMessages.ticketId,
          cnt: count(),
          lastAt: sql<string | number | null>`MAX(${ticketMessages.createdAt})`,
        })
        .from(ticketMessages)
        .where(inArray(ticketMessages.ticketId, ids))
        .groupBy(ticketMessages.ticketId)
    : [];
  const msgByTicket = new Map(msgRows.map((m) => [m.ticketId, m]));

  return {
    items: rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      category: r.category,
      state: r.state,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      tenantId: r.tenantId,
      tenantName: tenantNameOf(r.tenantFirstName, r.tenantLastName),
      tenantEmail: r.tenantEmail,
      messageCount: Number(msgByTicket.get(r.id)?.cnt ?? 0),
      lastMessageAt: toDate(msgByTicket.get(r.id)?.lastAt),
    })),
    total: Number(totalRow?.value ?? 0),
    page: p,
    pageSize: size,
  };
}

/** Admin detail view: ticket row + tenant identity + the SAME message shape
 *  as the user-path getTicket (attachments included). */
export async function adminGetTicket(ticketId: string): Promise<{
  ticket: AdminTicketListItem;
  messages: TicketMessageDto[];
}> {
  const db = getDb();
  const [row] = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      category: tickets.category,
      state: tickets.state,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      tenantId: tickets.tenantId,
      tenantFirstName: users.firstName,
      tenantLastName: users.lastName,
      tenantEmail: users.email,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.tenantId))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('تیکت'));

  const [msgAgg] = await db
    .select({
      cnt: count(),
      lastAt: sql<string | number | null>`MAX(${ticketMessages.createdAt})`,
    })
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, row.id));

  return {
    ticket: {
      id: row.id,
      subject: row.subject,
      category: row.category,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tenantId: row.tenantId,
      tenantName: tenantNameOf(row.tenantFirstName, row.tenantLastName),
      tenantEmail: row.tenantEmail,
      messageCount: Number(msgAgg?.cnt ?? 0),
      lastMessageAt: toDate(msgAgg?.lastAt),
    },
    messages: await fetchTicketMessages(row.id),
  };
}

/**
 * Admin reply. Parity checks against the user-path addTicketMessage:
 *  - SUPPORT/SUPER_ADMIN reply marks the ticket ANSWERED (same as user flow);
 *  - the user flow does NOT notify the tenant on reply (no notifyTenant call
 *    exists in support.service) — so none is replicated here either;
 *  - authorRole is stored exactly as passed (SUPER_ADMIN stays SUPER_ADMIN).
 */
export async function adminAddTicketMessage(
  ticketId: string,
  actor: { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' },
  body: string
): Promise<{ ok: true }> {
  const db = getDb();
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));
  if (ticket.state === 'CLOSED') {
    throw new AppError(ERR.VALIDATION('تیکت بسته شده است و امکان ارسال پاسخ وجود ندارد.'));
  }

  await db.transaction(async (tx) => {
    await tx.insert(ticketMessages).values({
      id: newId(),
      ticketId: ticket.id,
      authorId: actor.id,
      authorRole: actor.role,
      body: body.trim().slice(0, 5000),
    });
    // Explicit bump (the column also auto-updates on write) + ANSWERED state.
    await tx.update(tickets).set({ state: 'ANSWERED', updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
  });
  return { ok: true };
}

/** Closes a ticket (idempotent: already-closed → no-op success); bumps updatedAt. */
export async function adminCloseTicket(
  ticketId: string,
  _actor: { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' }
): Promise<{ ok: true }> {
  const db = getDb();
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));
  if (ticket.state !== 'CLOSED') {
    await db.update(tickets).set({ state: 'CLOSED', updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
  }
  return { ok: true };
}
