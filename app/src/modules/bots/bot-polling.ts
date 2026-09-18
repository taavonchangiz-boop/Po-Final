/**
 * Bot polling ingestion (scheduler-facing): for bots that run in POLLING mode
 * (Rubika always; others when webhook registration failed), pull updates from
 * the provider and feed them through the same dedupe/engine path as webhooks.
 *
 * The provider's optional getUpdates method is accessed defensively per the
 * agreed provider contract; offsets are kept in a process-local Map (single
 * scheduler instance per deployment — ARCHITECTURE.md §6).
 */
import { and, eq } from 'drizzle-orm';
import { decryptSecret } from '../../core/crypto.js';
import { logger } from '../../core/logger.js';
import { db } from '../../db/client.js';
import { bots } from '../../db/schema.js';
import { getBotProvider } from '../../providers/registry.js';
import type { UpdateEnvelope } from '../../providers/types.js';
import { ingestEnvelope, nextPollingOffset, setPollingOffset, type IngestResult } from './bot.engine.js';
import type { BotRow } from './bots.service.js';

const MAX_BOTS_PER_TICK = 20;

interface PollOutcome {
  botId: number;
  polled: number;
  ok: boolean;
  error?: string;
}

/** Poll one bot once; never throws. Uses the provider's normalized
 * UpdateEnvelope contract (getUpdates → { ok, updates? }) and feeds each
 * envelope through ingestEnvelope (the polling ingestion path). */
export async function pollBotOnce(bot: BotRow): Promise<PollOutcome> {
  try {
    const provider = getBotProvider(bot.provider, decryptSecret(bot.tokenEncrypted));
    if (!provider.capabilities.updateRetrieval) {
      return { botId: bot.id, polled: 0, ok: false, error: 'provider_does_not_support_polling' };
    }

    const offset = nextPollingOffset(bot.id) ?? 0;
    const result = await provider.getUpdates(offset);
    if (!result.ok || !Array.isArray(result.updates)) {
      return { botId: bot.id, polled: 0, ok: false, error: result.error ?? 'invalid_updates_response' };
    }

    let ingested = 0;
    let lastUpdateId = offset;
    for (const envelope of result.updates.slice(0, 50)) {
      const updateId = readRawUpdateId(envelope);
      if (updateId !== null && updateId >= lastUpdateId) lastUpdateId = updateId + 1;
      const ingest: IngestResult = await ingestEnvelope(bot, envelope, envelope.raw);
      if (ingest.inserted) ingested += 1;
    }
    setPollingOffset(bot.id, lastUpdateId);

    // Polling contact proves liveness.
    if (result.updates.length > 0) {
      await db.update(bots).set({ lastVerifiedAt: new Date() }).where(eq(bots.id, bot.id));
    }
    return { botId: bot.id, polled: ingested, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('bot_poll_failed', { botId: bot.id, error: message });
    await db
      .update(bots)
      .set({ lastError: 'دریافت پیام‌ها با روش polling ناموفق بود.', updatedAt: new Date() })
      .where(and(eq(bots.id, bot.id), eq(bots.status, 'ACTIVE')))
      .catch(() => undefined);
    return { botId: bot.id, polled: 0, ok: false, error: message };
  }
}

/** Telegram-style raw updates carry update_id — used to advance the offset. */
function readRawUpdateId(envelope: UpdateEnvelope): number | null {
  const raw = envelope.raw;
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as Record<string, unknown>)['update_id'];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Scheduler tick: poll every ACTIVE, enabled bot whose webhookState is POLLING.
 * Returns the total number of freshly ingested updates.
 */
export async function pollActiveBots(): Promise<number> {
  const rows = await db
    .select()
    .from(bots)
    .where(and(eq(bots.status, 'ACTIVE'), eq(bots.isEnabled, true), eq(bots.webhookState, 'POLLING')))
    .limit(MAX_BOTS_PER_TICK);

  let total = 0;
  for (const bot of rows) {
    const outcome = await pollBotOnce(bot);
    if (outcome.ok) total += outcome.polled;
  }
  return total;
}
