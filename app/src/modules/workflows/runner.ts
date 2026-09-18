/**
 * Workflow runner: executes an active workflow for a bot event.
 *
 * Safety model (api-contract + task 4-b-2):
 *  - per-run total timeout 60s (deadline checks between steps + overall race),
 *  - ≤ 6 outbound provider sends per run, ≤ 3 AI calls per run,
 *  - WAIT sleeps are bounded by the remaining deadline,
 *  - CONDITION is a gate: when it evaluates false, remaining steps are skipped
 *    and the run completes normally (v1 semantics, documented),
 *  - max 1 engine reply per bot event is enforced upstream in bot.engine.ts.
 */
import { eq, sql } from 'drizzle-orm';
import { logger } from '../../core/logger.js';
import { AnalyticsService } from '../../core/events.js';
import { decryptSecret } from '../../core/crypto.js';
import { db } from '../../db/client.js';
import { bots, workflowRuns, workflows } from '../../db/schema.js';
import { getBotProvider } from '../../providers/registry.js';
import type { ProviderButton, UpdateEnvelope } from '../../providers/types.js';
import { AiService } from '../ai/ai.service.js';

export interface WorkflowRunResult {
  completed: boolean;
  steps: number;
  error?: string;
}

const RUN_TIMEOUT_MS = 60_000;
const MAX_OUTBOUND = 6;
const MAX_AI_CALLS = 3;

interface StepLike {
  type: string;
  config: Record<string, unknown>;
}

function readString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' ? value : undefined;
}

function readButtons(config: Record<string, unknown>): ProviderButton[] | undefined {
  const raw = config['buttons'];
  if (!Array.isArray(raw)) return undefined;
  const buttons: ProviderButton[] = [];
  for (const item of raw.slice(0, 8)) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const text = typeof record['text'] === 'string' ? record['text'] : undefined;
    if (text === undefined) continue;
    const url = typeof record['url'] === 'string' ? record['url'] : undefined;
    const callbackData = typeof record['callbackData'] === 'string' ? record['callbackData'] : undefined;
    buttons.push({ text, url, callbackData } as ProviderButton);
  }
  return buttons.length > 0 ? buttons : undefined;
}

function evaluateCondition(config: Record<string, unknown>, event: UpdateEnvelope): boolean {
  const op = readString(config, 'op');
  const value = readString(config, 'value');
  const text = event.text ?? '';
  if (op === 'equals') return value !== undefined && text === value;
  // default op: contains (case-insensitive)
  if (value === undefined) return false;
  return text.toLowerCase().includes(value.toLowerCase());
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a workflow for a bot event. Never throws — failures are recorded on the
 * run row and surfaced through the result + events.
 */
export async function runWorkflow(
  workflowId: number,
  botId: number,
  userId: number,
  event: UpdateEnvelope,
): Promise<WorkflowRunResult> {
  const workflowRows = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  const workflow = workflowRows[0];
  if (!workflow || !workflow.isActive) {
    return { completed: false, steps: 0, error: 'workflow_inactive' };
  }

  const botRows = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  const bot = botRows[0];
  if (!bot || bot.userId !== userId) {
    return { completed: false, steps: 0, error: 'bot_not_found' };
  }

  const inserted = await db
    .insert(workflowRuns)
    .values({ workflowId, botId, userId, status: 'RUNNING' })
    .$returningId();
  const runId = inserted[0]?.id !== undefined ? Number(inserted[0].id) : null;

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  const steps = (workflow.definition.steps ?? []) as StepLike[];
  const definition = workflow.definition;
  let provider: ReturnType<typeof getBotProvider> | null = null;
  try {
    provider = getBotProvider(bot.provider, decryptSecret(bot.tokenEncrypted));
  } catch (err) {
    logger.warn('workflow_provider_init_failed', { botId, error: err instanceof Error ? err.message : String(err) });
  }

  let stepsExecuted = 0;
  let outboundCalls = 0;
  let aiCalls = 0;
  let aborted: string | null = null;

  for (const step of steps) {
    // Deadline check BETWEEN steps (bounded total runtime).
    if (Date.now() > deadline) {
      aborted = 'timeout';
      break;
    }

    try {
      if (step.type === 'SEND_MESSAGE' || step.type === 'SEND_BUTTONS') {
        outboundCalls += 1;
        if (outboundCalls > MAX_OUTBOUND) {
          aborted = 'outbound_limit';
          break;
        }
        const text = readString(step.config, 'text') ?? '';
        if (provider !== null && text.length > 0 && event.chatId) {
          const buttons = readButtons(step.config);
          await provider.sendMessage(event.chatId, text, buttons !== undefined ? [buttons] : undefined);
        }
        stepsExecuted += 1;
      } else if (step.type === 'AI_REPLY') {
        aiCalls += 1;
        if (aiCalls > MAX_AI_CALLS) {
          aborted = 'ai_limit';
          break;
        }
        const basePrompt = readString(step.config, 'prompt');
        const composed = basePrompt ? `${basePrompt}\n\n${event.text ?? ''}` : (event.text ?? '');
        const reply = await AiService.createInlineReply(userId, botId, composed);
        if (reply !== null && reply.length > 0 && event.chatId) {
          outboundCalls += 1;
          if (outboundCalls > MAX_OUTBOUND) {
            aborted = 'outbound_limit';
            break;
          }
          if (provider !== null) {
            await provider.sendMessage(event.chatId, reply);
          }
        }
        stepsExecuted += 1;
      } else if (step.type === 'WAIT') {
        const secondsRaw = step.config['seconds'];
        const seconds = typeof secondsRaw === 'number' ? Math.min(60, Math.max(1, Math.trunc(secondsRaw))) : 1;
        const remaining = deadline - Date.now();
        await sleep(Math.min(seconds * 1000, Math.max(0, remaining)));
        stepsExecuted += 1;
      } else if (step.type === 'CONDITION') {
        // Gate semantics: false → remaining steps are skipped (run completes).
        if (!evaluateCondition(step.config, event)) {
          stepsExecuted += 1;
          break;
        }
        stepsExecuted += 1;
      } else {
        // Unknown step type (future schema versions): skip defensively.
        stepsExecuted += 1;
      }
    } catch (err) {
      aborted = 'step_error';
      logger.warn('workflow_step_failed', {
        runId,
        step: step.type,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }

  const status = aborted === null ? 'COMPLETED' : aborted === 'timeout' ? 'TIMEOUT' : 'FAILED';
  const error =
    aborted === 'outbound_limit'
      ? 'سقف ارسال پیام در این گردش کار پر شد.'
      : aborted === 'ai_limit'
        ? 'سقف فراخوانی هوش مصنوعی در این گردش کار پر شد.'
        : aborted === 'timeout'
          ? 'زمان اجرای گردش کار به پایان رسید.'
          : aborted === 'step_error'
            ? 'اجرای یکی از مراحل گردش کار ناموفق بود.'
            : undefined;

  if (runId !== null) {
    await db
      .update(workflowRuns)
      .set({
        status,
        stepsExecuted,
        aiCalls,
        outboundCalls,
        error: error ?? null,
        finishedAt: new Date(),
      })
      .where(eq(workflowRuns.id, runId));
  }

  await db
    .update(workflows)
    .set({ runCount: sql`${workflows.runCount} + 1`, updatedAt: new Date() })
    .where(eq(workflows.id, workflowId));

  AnalyticsService.trackEvent({
    userId,
    type: status === 'COMPLETED' ? 'workflow.completed' : 'workflow.failed',
    subjectType: 'workflow',
    subjectId: workflowId,
    data: { botId, runId: runId ?? undefined, steps: stepsExecuted, trigger: definition.trigger?.type },
  });

  return status === 'COMPLETED'
    ? { completed: true, steps: stepsExecuted }
    : { completed: false, steps: stepsExecuted, error: error ?? 'workflow_failed' };
}
