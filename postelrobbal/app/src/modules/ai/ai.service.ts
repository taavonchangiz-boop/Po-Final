import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { aiJobs, aiUsageMonthly, systemSettings } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { emitEvent } from '../../core/events.js';
import { enqueue } from '../../queue/queues.js';
import { assertWithinLimit } from '../subscriptions/plan.service.js';
import { aiComplete, AI_PROVIDER_IDS } from '../../providers/ai/ai-providers.js';

/**
 * AI orchestration (§28): quota accounting (ai_usage_monthly), queue-backed
 * jobs for the API surface, and direct (synchronous) completion for the bot
 * event worker — never routed through the ai-jobs queue for auto-reply.
 */
export type AiPurpose = 'CAPTION' | 'AUTO_REPLY' | 'CUSTOM';

function currentPeriodYm(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM UTC
}

/**
 * Atomic quota accounting: assert plan limit FIRST (reads usage vs limit via
 * plan context), then upsert-increment ai_usage_monthly for the UTC period.
 */
export async function consumeAiQuota(tenantId: string): Promise<void> {
  await assertWithinLimit(tenantId, 'ai_monthly');
  const db = getDb();
  await db
    .insert(aiUsageMonthly)
    .values({ tenantId, periodYm: currentPeriodYm(), requestCount: 1, tokenCount: 0 })
    .onDuplicateKeyUpdate({ set: { requestCount: sql`${aiUsageMonthly.requestCount} + 1` } });
}

async function countTokens(tenantId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  const db = getDb();
  await db
    .update(aiUsageMonthly)
    .set({ tokenCount: sql`${aiUsageMonthly.tokenCount} + ${tokens}` })
    .where(and(eq(aiUsageMonthly.tenantId, tenantId), eq(aiUsageMonthly.periodYm, currentPeriodYm())));
}

/** Default provider: explicit override → system_settings['ai'].default_provider → 'openai'. */
async function resolveProvider(explicit?: string): Promise<string> {
  if (explicit && explicit.trim()) {
    const p = explicit.trim().toLowerCase();
    if ((AI_PROVIDER_IDS as readonly string[]).includes(p)) return p;
    throw new AppError(ERR.VALIDATION('سرویس‌دهندهٔ هوش مصنوعی پشتیبانی نمی‌شود.'));
  }
  const db = getDb();
  const [setting] = await db
    .select({ valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, 'ai'))
    .limit(1);
  const raw = setting?.valueJson?.['default_provider'];
  if (typeof raw === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(raw.toLowerCase())) {
    return raw.toLowerCase();
  }
  return 'openai';
}

export async function requestAiJob(
  tenantId: string,
  input: { purpose: AiPurpose; inputText: string; provider?: string }
): Promise<{ jobId: string }> {
  await consumeAiQuota(tenantId);
  const db = getDb();
  const jobId = newId();
  const provider = await resolveProvider(input.provider);
  await db.insert(aiJobs).values({
    id: jobId,
    tenantId,
    purpose: input.purpose,
    provider,
    inputText: input.inputText,
  });
  await enqueue('ai-jobs', 'run', { jobId }, { jobId: `ai:${jobId}` });
  await emitEvent({
    name: 'ai.requested',
    tenantId,
    subjectType: 'ai_job',
    subjectId: jobId,
    props: { purpose: input.purpose, provider },
  });
  return { jobId };
}

/** Queue-backed caption generation — the frontend polls GET /ai/jobs/:id. */
export async function requestAiCaption(tenantId: string, text: string): Promise<{ jobId: string }> {
  return requestAiJob(tenantId, { purpose: 'CAPTION', inputText: text });
}

/**
 * Direct (non-queued) completion for the bot event worker: counts usage then
 * calls the AI provider synchronously with a hard 30s timeout.
 */
export async function aiProviderComplete(tenantId: string, system: string, user: string): Promise<string> {
  await consumeAiQuota(tenantId);
  const provider = await resolveProvider(undefined);
  const result = await aiComplete(provider, { system, user, timeoutMs: 30_000, maxTokens: 500 });
  await countTokens(tenantId, (result.promptTokens ?? 0) + (result.completionTokens ?? 0));
  return result.text;
}

/** Synchronous small completion for settings testing — quota-guarded, 30s. */
export async function generateAiSync(
  tenantId: string,
  input: { system?: string; text: string }
): Promise<{ text: string; provider: string }> {
  await consumeAiQuota(tenantId);
  const provider = await resolveProvider(undefined);
  const result = await aiComplete(provider, {
    ...(input.system ? { system: input.system } : {}),
    user: input.text,
    timeoutMs: 30_000,
    maxTokens: 500,
  });
  await countTokens(tenantId, (result.promptTokens ?? 0) + (result.completionTokens ?? 0));
  return { text: result.text, provider };
}

export async function getAiJob(
  tenantId: string,
  jobId: string
): Promise<{
  id: string;
  purpose: string;
  provider: string;
  status: string;
  inputText: string;
  outputText: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.tenantId, tenantId)))
    .limit(1);
  if (!job) throw new AppError(ERR.NOT_FOUND('درخواست هوش مصنوعی'));
  return {
    id: job.id,
    purpose: job.purpose,
    provider: job.provider,
    status: job.status,
    inputText: job.inputText,
    outputText: job.outputText,
    promptTokens: job.promptTokens,
    completionTokens: job.completionTokens,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

export async function getAiUsage(
  tenantId: string
): Promise<{ periodYm: string; requestCount: number; tokenCount: number }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(aiUsageMonthly)
    .where(and(eq(aiUsageMonthly.tenantId, tenantId), eq(aiUsageMonthly.periodYm, currentPeriodYm())))
    .limit(1);
  return {
    periodYm: currentPeriodYm(),
    requestCount: row?.requestCount ?? 0,
    tokenCount: row?.tokenCount ?? 0,
  };
}
