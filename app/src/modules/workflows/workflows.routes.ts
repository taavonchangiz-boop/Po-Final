/**
 * Workflow routes: CRUD + run history (api-contract "Workflows" section).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendOk } from '../../core/envelope.js';
import { validationError } from '../../core/errors.js';
import { publishLimiter } from '../../security/rate-limit.js';
import { requireAuth } from '../../security/session.js';
import { WorkflowService } from './workflows.service.js';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const IdParams = z.object({ id: z.coerce.number().int().min(1) });

function serializeWorkflow(workflow: Awaited<ReturnType<typeof WorkflowService.get>>) {
  return {
    id: workflow.id,
    botId: workflow.botId,
    name: workflow.name,
    definition: workflow.definition,
    isActive: workflow.isActive,
    runCount: workflow.runCount,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

export function registerWorkflowRoutes(app: FastifyInstance): void {
  app.get('/api/v1/workflows', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = PaginationSchema.extend({ botId: z.coerce.number().int().min(1).optional() }).safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await WorkflowService.list(request.currentUser!.id, {
      botId: parsed.data.botId,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
    return sendOk(reply, { items: items.map(serializeWorkflow), total, page: parsed.data.page, limit: parsed.data.limit });
  });

  app.post('/api/v1/workflows', { preHandler: requireAuth, ...publishLimiter.config }, async (request, reply) => {
    const parsed = z
      .object({
        botId: z.coerce.number().int().min(1),
        name: z.string().min(1).max(190),
        definition: z.unknown(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    // parsed.data.definition is optional in the zod output type but a required
    // create input — pass it explicitly (undefined fails service-side validation).
    const workflow = await WorkflowService.create(request.currentUser!.id, {
      botId: parsed.data.botId,
      name: parsed.data.name,
      definition: parsed.data.definition,
    });
    return sendOk(reply, serializeWorkflow(workflow), 201);
  });

  app.patch('/api/v1/workflows/:id', { preHandler: requireAuth, ...publishLimiter.config }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const parsed = z
      .object({
        name: z.string().min(1).max(190).optional(),
        definition: z.unknown().optional(),
        isActive: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const workflow = await WorkflowService.update(request.currentUser!.id, params.data.id, parsed.data);
    return sendOk(reply, serializeWorkflow(workflow));
  });

  app.delete('/api/v1/workflows/:id', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    await WorkflowService.delete(request.currentUser!.id, params.data.id);
    return sendOk(reply, { ok: true });
  });

  app.get('/api/v1/workflows/:id/runs', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const parsed = PaginationSchema.safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await WorkflowService.listRuns(
      request.currentUser!.id,
      params.data.id,
      parsed.data.page,
      parsed.data.limit,
    );
    return sendOk(reply, { items, total, page: parsed.data.page, limit: parsed.data.limit });
  });
}
