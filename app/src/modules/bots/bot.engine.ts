/**
 * Bot engine: raw provider update → deduped bot_events row → envelope →
 * command match → workflow match → AI reply → provider send.
 *
 * Loop protection:
 *  - updates whose sender `is_bot` are ignored (bot-to-bot echo loops),
 *  - max ONE direct engine outbound per event (workflow runs are separately
 *    bounded by the runner's 6-send cap),
 *  - per-chat rate limit: at most 10 bot sends per chat per 60s. The window is
 *    an in-memory, process-local Map (single API process per deployment
 *    topology — see ARCHITECTURE.md §1); documented, reset on restart.
 *  - bounded fire-and-forget: at most MAX_INFLIGHT concurrent processBotEvent
 *    executions; overflow is dropped (dedupe + provider retries cover it).
 */
import { and, eq } from 'drizzle-orm';
import { decryptSecret } from '../../core/crypto.js';
import { AnalyticsService } from '../../core/events.js';
import { logger } from '../../core/logger.js';
import { db } from '../../db/client.js';
import { botEvents, botUsers, bots, workflows } from '../../db/schema.js';
import { getBotProvider } from '../../providers/registry.js';
import type { ProviderButton, ProviderKind, SendOutcome, UpdateEnvelope } from '../../providers/types.js';
import { AiService } from '../ai/ai.service.js';
import { runWorkflow } from '../workflows/runner.js';

const MAX_INFLIGHT = 100;
const CHAT_RATE_LIMIT = 10;
const CHAT_RATE_WINDOW_MS = 60_000;
const MAX_STORED_TEXT = 500;

let inflight = 0;
const recentSends = new Map<string, number[]>();
const pollingOffsets = new Map<number, number>();

/* --------------------------- rate limiting --------------------------- */

/** True when a send to (botId, chatId) is allowed under the per-chat cap. */
export function allowBotSend(botId: number, chatId: string, now = Date.now()): boolean {
  const key = `${botId}:${chatId}`;
  const timestamps = (recentSends.get(key) ?? []).filter((ts) => now - ts < CHAT_RATE_WINDOW_MS);
  if (timestamps.length >= CHAT_RATE_LIMIT) {
    recentSends.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  recentSends.set(key, timestamps);
  return true;
}

export function resetRateLimits(): void {
  recentSends.clear();
}

/* ------------------------ raw update extraction ------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface ExtractedUpdate {
  externalEventId: string;
  type: 'message' | 'callback_query' | 'member_joined';
  chatId: string | null;
  senderRef: string | null;
  text: string | null;
  callbackData: string | null;
  senderIsBot: boolean;
  /** Privacy-minimal snapshot persisted in bot_events.payload. */
  snapshot: Record<string, unknown>;
  raw: Record<string, unknown>;
}

/** Normalize a Telegram/Bale/Rubika-style raw update. Null when unusable. */
export function extractUpdate(raw: unknown): ExtractedUpdate | null {
  const update = asRecord(raw);
  if (update === null) return null;
  const updateId = readNumber(update, 'update_id');
  if (updateId === null) return null;

  const callback = asRecord(update['callback_query']);
  const messageRecord =
    asRecord(update['message']) ?? asRecord(update['edited_message']) ?? (callback !== null ? asRecord(callback['message']) : null);

  const chat = messageRecord !== null ? asRecord(messageRecord['chat']) : null;
  const from = messageRecord !== null ? asRecord(messageRecord['from']) : (callback !== null ? asRecord(callback['from']) : null);
  const chatId = chat !== null ? (readNumber(chat, 'id')?.toString() ?? readString(chat, 'id')) : null;
  const senderRef =
    from !== null ? (readNumber(from, 'id')?.toString() ?? readString(from, 'id')) : null;
  const senderIsBot = from !== null && from['is_bot'] === true;

  if (callback !== null) {
    return {
      externalEventId: String(updateId),
      type: 'callback_query',
      chatId,
      senderRef,
      text: null,
      callbackData: readString(callback, 'data'),
      senderIsBot,
      snapshot: { type: 'callback_query', chatId, senderRef, callbackData: readString(callback, 'data') },
      raw: update,
    };
  }

  if (messageRecord !== null) {
    const hasNewMember =
      messageRecord['new_chat_member'] !== undefined || messageRecord['new_chat_members'] !== undefined;
    const text = readString(messageRecord, 'text');
    return {
      externalEventId: String(updateId),
      type: hasNewMember ? 'member_joined' : 'message',
      chatId,
      senderRef,
      text: text !== null ? text.slice(0, 4000) : null,
      callbackData: null,
      senderIsBot,
      snapshot: {
        type: hasNewMember ? 'member_joined' : 'message',
        chatId,
        senderRef,
        text: text !== null ? text.slice(0, MAX_STORED_TEXT) : undefined,
      },
      raw: update,
    };
  }

  return null;
}

/* ------------------------------ ingestion ------------------------------ */

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; errno?: unknown };
  return e.code === 'ER_DUP_ENTRY' || e.errno === 1062;
}

export interface IngestResult {
  inserted: boolean;
  botEventId: number | null;
}

/**
 * Dedupe-insert a NORMALIZED envelope (polling path — providers return
 * UpdateEnvelopes from getUpdates) and kick off fire-and-forget processing.
 */
export async function ingestEnvelope(bot: typeof bots.$inferSelect, envelope: UpdateEnvelope, raw: unknown = envelope.raw): Promise<IngestResult> {
  const extracted = extractUpdate(raw) ?? buildFallbackExtraction(envelope);

  let insertedId: number | null = null;
  try {
    const inserted = await db
      .insert(botEvents)
      .values({
        botId: bot.id,
        provider: bot.provider,
        externalEventId: envelope.externalEventId,
        type: envelope.type.slice(0, 40),
        chatId: envelope.chatId ?? null,
        senderRef: envelope.senderRef ?? null,
        payload: extracted.snapshot,
      })
      .$returningId();
    insertedId = inserted[0]?.id !== undefined ? Number(inserted[0].id) : null;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return { inserted: false, botEventId: null }; // dedupe: provider redelivery
    }
    throw err;
  }

  AnalyticsService.trackEvent({
    userId: bot.userId,
    type: 'bot.message.received',
    subjectType: 'bot',
    subjectId: bot.id,
    data: { type: envelope.type, provider: bot.provider },
  });

  if (insertedId !== null && !extracted.senderIsBot && inflight < MAX_INFLIGHT) {
    inflight += 1;
    void processBotEvent(bot.id, envelope, insertedId)
      .catch((err: unknown) => {
        logger.warn('bot_event_processing_failed', {
          botId: bot.id,
          botEventId: insertedId,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        inflight = Math.max(0, inflight - 1);
      });
  }

  return { inserted: true, botEventId: insertedId };
}

/** Fallback when the raw update cannot be parsed but the provider normalized it. */
function buildFallbackExtraction(envelope: UpdateEnvelope): ExtractedUpdate {
  return {
    externalEventId: envelope.externalEventId,
    type: envelope.type === 'callback_query' ? 'callback_query' : 'message',
    chatId: envelope.chatId ?? null,
    senderRef: envelope.senderRef ?? null,
    text: envelope.text ?? null,
    callbackData: envelope.callbackData ?? null,
    senderIsBot: false,
    snapshot: {
      type: envelope.type,
      chatId: envelope.chatId,
      senderRef: envelope.senderRef,
      text: envelope.text !== undefined ? envelope.text.slice(0, MAX_STORED_TEXT) : undefined,
    },
    raw: envelope.raw ?? {},
  };
}

/**
 * Webhook path: parse the raw provider update, then share the envelope path.
 */
export async function ingestBotUpdate(bot: typeof bots.$inferSelect, rawUpdate: unknown): Promise<IngestResult> {
  const extracted = extractUpdate(rawUpdate);
  if (extracted === null) return { inserted: false, botEventId: null };

  const envelope: UpdateEnvelope = {
    externalEventId: extracted.externalEventId,
    type: extracted.type,
    chatId: extracted.chatId ?? undefined,
    senderRef: extracted.senderRef ?? undefined,
    text: extracted.text ?? undefined,
    callbackData: extracted.callbackData ?? undefined,
    raw: extracted.raw,
  };
  return ingestEnvelope(bot, envelope, extracted.raw);
}

/* ----------------------------- processing ----------------------------- */

function normalizeCommand(text: string): string {
  const first = text.trim().split(/\s+/)[0] ?? '';
  // Telegram allows /command@BotName — strip the target suffix.
  return first.split('@')[0]?.toLowerCase() ?? '';
}

/** Fire-and-forget event processor (never throws to the caller). */
export async function processBotEvent(botId: number, event: UpdateEnvelope, botEventId?: number | null): Promise<void> {
  const botRows = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  const bot = botRows[0];
  if (!bot || bot.status !== 'ACTIVE' || !bot.isEnabled) return;
  if (!event.chatId) return;

  const text = event.text !== undefined && event.text.length > 0 ? event.text : null;

  // Privacy-minimal user tracking.
  await db
    .insert(botUsers)
    .values({
      botId: bot.id,
      provider: bot.provider,
      externalUserId: event.senderRef || 'unknown',
    })
    .onDuplicateKeyUpdate({ set: { lastSeenAt: new Date() } });

  const provider = getBotProvider(bot.provider as ProviderKind, decryptSecret(bot.tokenEncrypted));
  const command = text !== null ? normalizeCommand(text) : '';

  // 1) Command match → single canned response.
  let replied = false;
  const commands = bot.commands ?? [];
  if (command.length > 0) {
    const match = commands.find((cmd) => cmd.command.toLowerCase() === command);
    if (match !== undefined) {
      replied = await sendBotMessage(bot, provider, event.chatId, match.response, undefined, botEventId);
    }
  }

  // 2) Workflow match (first active workflow whose trigger fires).
  if (!replied) {
    const workflowRows = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.botId, bot.id), eq(workflows.isActive, true)))
      .orderBy(workflows.id)
      .limit(10);
    const trigger = event.type;
    for (const workflow of workflowRows) {
      const wfTrigger = workflow.definition.trigger;
      if (wfTrigger.type === 'COMMAND') {
        const expected = (wfTrigger.value ?? '').toLowerCase();
        const normalized = expected.startsWith('/') ? expected : `/${expected}`;
        if (command.length === 0 || command !== normalized) continue;
      } else if (wfTrigger.type === 'MESSAGE_KEYWORD') {
        const keyword = (wfTrigger.value ?? '').toLowerCase();
        if (text === null || keyword.length === 0 || !text.toLowerCase().includes(keyword)) continue;
      } else if (wfTrigger.type === 'ANY_MESSAGE') {
        if (text === null && event.type !== 'callback_query') continue;
      } else if (wfTrigger.type === 'NEW_MEMBER') {
        if (trigger !== 'member_joined') continue;
      }

      await runWorkflow(workflow.id, bot.id, bot.userId, event);
      replied = true;
      break;
    }
  }

  // 3) AI reply (only when nothing else matched).
  if (!replied && bot.aiConfig?.enabled === true && text !== null && text.trim().length > 0) {
    const reply = await AiService.createInlineReply(bot.userId, bot.id, text);
    if (reply !== null && reply.length > 0) {
      await sendBotMessage(bot, provider, event.chatId, reply, undefined, botEventId);
    }
  }

  await markProcessed(botEventId);
}

async function markProcessed(botEventId?: number | null): Promise<void> {
  if (botEventId === undefined || botEventId === null) return;
  await db.update(botEvents).set({ processedAt: new Date() }).where(eq(botEvents.id, botEventId));
}

async function sendBotMessage(
  bot: typeof bots.$inferSelect,
  provider: ReturnType<typeof getBotProvider>,
  chatId: string,
  text: string,
  buttons: ProviderButton[] | undefined,
  botEventId?: number | null,
): Promise<boolean> {
  if (text.trim().length === 0) return false;

  // Loop protection: per-chat rate limit (10 / 60s, process-local).
  if (!allowBotSend(bot.id, chatId)) {
    logger.warn('bot_send_rate_limited', { botId: bot.id, chatIdHash: chatId.slice(0, 4) });
    return false;
  }

  let outcome: SendOutcome | null = null;
  try {
    outcome = await provider.sendMessage(chatId, text, buttons !== undefined ? [buttons] : undefined);
  } catch (err) {
    logger.warn('bot_send_error', {
      botId: bot.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  const ok = outcome !== null && typeof outcome === 'object' && outcome.ok === true;
  AnalyticsService.trackEvent({
    userId: bot.userId,
    type: 'bot.message.sent',
    subjectType: 'bot',
    subjectId: bot.id,
    data: { ok, botEventId: botEventId ?? undefined },
  });
  return ok;
}

/** For polling: remember the provider offset (process-local). */
export function nextPollingOffset(botId: number): number | undefined {
  return pollingOffsets.get(botId);
}

export function setPollingOffset(botId: number, offset: number): void {
  pollingOffsets.set(botId, offset);
}
