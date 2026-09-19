import { and, count, desc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { tickets, ticketMessages } from '../../db/schema.js';
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

/** Ownership enforced here; support roles may open any ticket. */
export async function getTicket(
  tenantId: string,
  ticketId: string,
  isSupport: boolean
): Promise<{ ticket: TicketListItem; messages: Array<{ id: string; authorRole: string; authorId: string | null; body: string; createdAt: Date }> }> {
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
    })
    .from(ticketMessages)
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
    messages,
  };
}

/**
 * Role-aware reply (§145): USER reply reopens the ticket (OPEN);
 * SUPPORT/SUPER_ADMIN reply marks it ANSWERED.
 */
export async function addTicketMessage(
  tenantId: string,
  ticketId: string,
  author: { id: string; role: ActorRole },
  body: string
): Promise<{ state: TicketState }> {
  const db = getDb();
  const isSupport = author.role !== 'USER';
  const where = isSupport ? eq(tickets.id, ticketId) : and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId));
  const [ticket] = await db.select().from(tickets).where(where).limit(1);
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));
  if (ticket.state === 'CLOSED' && !isSupport) {
    throw new AppError(ERR.CONFLICT('این تیکت بسته شده است. برای ادامه، تیکت جدیدی بسازید.'));
  }

  const nextState: TicketState = isSupport ? 'ANSWERED' : 'OPEN';
  await db.transaction(async (tx) => {
    await tx.insert(ticketMessages).values({
      id: newId(),
      ticketId: ticket.id,
      authorId: author.id,
      authorRole: author.role,
      body: body.trim().slice(0, 5000),
    });
    await tx.update(tickets).set({ state: nextState }).where(eq(tickets.id, ticket.id));
  });
  return { state: nextState };
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
