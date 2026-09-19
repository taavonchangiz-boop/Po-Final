import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { roleHasPermission } from '../../security/permissions.js';
import { TICKET_CATEGORIES, listTickets, createTicket, getTicket, addTicketMessage, closeTicket, type ActorRole } from './support.service.js';
import { parseWith } from '../../core/validation.js';

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
    const input = parse(messageSchema, req.body);
    const author = { id: me.id, role: me.role };
    const data = await addTicketMessage(me.id, id, author, input.body);
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
