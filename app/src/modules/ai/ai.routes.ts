/**
 * AI routes: job submission (202 + queue), listing, status polling, usage.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendOk } from '../../core/envelope.js';
import { validationError } from '../../core/errors.js';
import { enqueue } from '../../queue/queues.js';
import { aiLimiter } from '../../security/rate-limit.js';
import { requireAuth } from '../../security/session.js';
import { AiPurposeEnum, AiProviderEnum, AiService } from './ai.service.js';

const CreateJobSchema = z.object({
  purpose: AiPurposeEnum,
  prompt: z.string().min(1).max(8000),
  system: z.string().max(2000).optional(),
  provider: AiProviderEnum.optional(),
  model: z.string().max(80).optional(),
  botId: z.coerce.number().int().min(1).optional(),
});

function parsePaginationQuery(query: unknown): { page: number; limit: number } {
  const parsed = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .safeParse(query);
  if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
  return parsed.data;
}

function serializeJob(job: Awaited<ReturnType<typeof AiService.getJob>>) {
  return {
    id: job.id,
    purpose: job.purpose,
    provider: job.provider,
    model: job.model,
    status: job.status,
    output: job.output,
    error: job.error,
    errorClass: job.errorClass,
    creditsUsed: job.creditsUsed,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

export function registerAiRoutes(app: FastifyInstance): void {
  app.post('/api/v1/ai/jobs', { preHandler: requireAuth, ...aiLimiter.config }, async (request, reply) => {
    const parsed = CreateJobSchema.safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());

    const job = await AiService.createJob(request.currentUser!.id, {
      purpose: parsed.data.purpose,
      prompt: parsed.data.prompt,
      system: parsed.data.system,
      provider: parsed.data.provider,
      model: parsed.data.model,
      botId: parsed.data.botId,
    });

    const queued = await enqueue('ai-jobs', 'run', { jobId: job.id });

    // 202 Accepted — honest: queued=false means Redis was unavailable; the job
    // stays QUEUED and the scheduler/outbox path can pick it up later.
    return sendOk(reply, { jobId: job.id, status: job.status, queued }, 202);
  });

  app.get('/api/v1/ai/jobs', { preHandler: requireAuth }, async (request, reply) => {
    const { page, limit } = parsePaginationQuery(request.query);
    const { items, total } = await AiService.listJobs(request.currentUser!.id, page, limit);
    return sendOk(reply, { items: items.map(serializeJob), total, page, limit });
  });

  app.get('/api/v1/ai/usage', { preHandler: requireAuth }, async (request, reply) => {
    const usage = await AiService.getUsage(request.currentUser!.id);
    return sendOk(reply, usage);
  });

  app.get('/api/v1/ai/jobs/:id', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const job = await AiService.getJob(request.currentUser!.id, parsed.data.id);
    return sendOk(reply, serializeJob(job));
  });
}
