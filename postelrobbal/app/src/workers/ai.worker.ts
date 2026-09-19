import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { createWorker } from '../queue/connection.js';
import { loadEnv } from '../config/env.js';
import { getDb } from '../db/client.js';
import { aiJobs } from '../db/schema.js';
import { aiComplete } from '../providers/ai/ai-providers.js';
import { resolveAiRuntimeOverride } from '../modules/admin/system-settings.service.js';
import { emitEvent } from '../core/events.js';
import { AppError } from '../core/errors.js';
import { createLogger } from '../core/logger.js';

const CAPTION_SYSTEM_FA =
  'یک کپشن کوتاه، خوانا و جذاب به زبان فارسی برای متن کاربر بنویس. بدون HTML، حداکثر ۳ پاراگراف و در صورت تناسب از ایموجی استفاده کن.';

/**
 * AI jobs worker: QUEUED → RUNNING → COMPLETED/FAILED. Bounded by the hard
 * timeout inside aiComplete; failures are terminal (no retry of misconfigured
 * or quota-exhausted jobs).
 */
export function startAiWorker(): Worker {
  const env = loadEnv();
  const log = createLogger('ai-worker');

  const processor = async (job: Job): Promise<void> => {
    const data = job.data as { jobId?: unknown };
    if (typeof data.jobId !== 'string') return;
    const db = getDb();
    const [aiJob] = await db.select().from(aiJobs).where(eq(aiJobs.id, data.jobId)).limit(1);
    if (!aiJob || aiJob.status !== 'QUEUED') return; // idempotent: never re-run a started job

    await db.update(aiJobs).set({ status: 'RUNNING' }).where(eq(aiJobs.id, aiJob.id));

    try {
      // Round 18: admin-stored key/custom base URL/model override the env defaults.
      const provider = aiJob.provider || 'openai';
      const override = await resolveAiRuntimeOverride(provider);
      const result = await aiComplete(
        provider,
        {
          ...(aiJob.purpose === 'CAPTION' ? { system: CAPTION_SYSTEM_FA } : {}),
          user: aiJob.inputText,
          timeoutMs: 30_000,
          maxTokens: 700,
        },
        override
      );
      await db
        .update(aiJobs)
        .set({
          status: 'COMPLETED',
          outputText: result.text,
          promptTokens: result.promptTokens ?? null,
          completionTokens: result.completionTokens ?? null,
          finishedAt: new Date(),
        })
        .where(eq(aiJobs.id, aiJob.id));
      await emitEvent({
        name: 'ai.completed',
        tenantId: aiJob.tenantId,
        subjectType: 'ai_job',
        subjectId: aiJob.id,
        props: { purpose: aiJob.purpose, provider: aiJob.provider },
      });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'AI_FAILED';
      await db
        .update(aiJobs)
        .set({ status: 'FAILED', errorCode: code.slice(0, 80), finishedAt: new Date() })
        .where(eq(aiJobs.id, aiJob.id));
      await emitEvent({
        name: 'ai.failed',
        tenantId: aiJob.tenantId,
        subjectType: 'ai_job',
        subjectId: aiJob.id,
        props: { purpose: aiJob.purpose, provider: aiJob.provider, errorCode: code },
      });
      log.warn({ jobId: aiJob.id, code }, 'ai_job_failed');
    }
  };

  return createWorker(
    'ai-jobs',
    processor as unknown as Parameters<typeof createWorker>[1],
    { concurrency: env.AI_WORKER_CONCURRENCY }
  );
}
