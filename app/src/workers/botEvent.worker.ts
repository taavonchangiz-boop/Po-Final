import { Worker, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { createWorker } from '../queue/connection.js';
import { getDb } from '../db/client.js';
import { bots, botEvents, botUsers, botCommands, botKeywords, workflows } from '../db/schema.js';
import { newId } from '../core/ids.js';
import { decryptSecret } from '../security/encryption.js';
import { getProvider } from '../providers/index.js';
import type { Platform } from '../providers/types.js';
import { emitEvent } from '../core/events.js';
import { createLogger } from '../core/logger.js';
import { notifyTenant } from '../modules/notifications/delivery.js';
import { extractBotMessage } from '../modules/bots/bot.service.js';
import { aiProviderComplete } from '../modules/ai/ai.service.js';
import { executeWorkflow } from '../modules/workflows/workflow.engine.js';

/**
 * Bot event processor: consumes deduplicated bot_events (§187), upserts
 * bot_users, matches commands/keywords/workflows and answers through the
 * platform provider. Auto-reply AI is called DIRECTLY here (30s hard timeout
 * inside the provider layer) — never via the ai-jobs queue — with quota
 * counted through consumeAiQuota.
 */

const DEFAULT_AI_PROMPT_FA =
  'شما پاسخ‌گوی خودکار یک کسب‌وکار ایرانی هستید. کوتاه، مؤدبانه و فارسی پاسخ بده. اگر پاسخ را نمی‌دانی، کاربر را به پشتیبانی ارجاع بده.';
const AI_FALLBACK_FA = 'در پاسخ‌گویی خودکار خطایی رخ داد. لطفاً بعداً دوباره پیام بدهید.';

const SPAM_WINDOW_MS = 3_600_000; // §191: 20 outbound messages per chat per hour
const SPAM_MAX_PER_WINDOW = 20;

type InlineButton = { label: string; url?: string; callback?: string };
type BotRow = typeof bots.$inferSelect;
type SendFn = (chatRef: string, text: string, buttons?: InlineButton[]) => Promise<void>;

function coerceButtons(value: unknown): InlineButton[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const buttons: InlineButton[] = [];
  for (const raw of value.slice(0, 8)) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    if (typeof b['label'] !== 'string' || !b['label']) continue;
    buttons.push({
      label: b['label'].slice(0, 64),
      ...(typeof b['url'] === 'string' ? { url: b['url'].slice(0, 255) } : {}),
      ...(typeof b['callback'] === 'string' ? { callback: b['callback'].slice(0, 64) } : {}),
    });
  }
  return buttons.length ? buttons : undefined;
}

export function startBotEventWorker(): Worker {
  const log = createLogger('bot-event-worker');

  // §191 in-memory spam control, bounded and process-local (single worker contract).
  const sendLog = new Map<string, number[]>();
  const spamAllowed = (key: string): boolean => {
    const now = Date.now();
    const recent = (sendLog.get(key) ?? []).filter((t) => now - t < SPAM_WINDOW_MS);
    if (recent.length >= SPAM_MAX_PER_WINDOW) {
      sendLog.set(key, recent);
      return false;
    }
    recent.push(now);
    sendLog.set(key, recent);
    if (sendLog.size > 10_000) {
      for (const [k, v] of sendLog) {
        if (v.every((t) => now - t >= SPAM_WINDOW_MS)) sendLog.delete(k);
      }
      if (sendLog.size > 10_000) sendLog.clear();
    }
    return true;
  };

  // One failure notification per bot per hour (in-memory guard).
  const lastNotifyAt = new Map<string, number>();
  const shouldNotify = (botId: string): boolean => {
    const now = Date.now();
    const last = lastNotifyAt.get(botId) ?? 0;
    if (now - last < SPAM_WINDOW_MS) return false;
    lastNotifyAt.set(botId, now);
    return true;
  };

  const makeSend = (bot: BotRow, token: string): SendFn => {
    const provider = getProvider(bot.platform);
    const caps = provider.capabilities();
    return async (chatRef, text, buttons) => {
      if (!spamAllowed(`${bot.id}:${chatRef}`)) {
        log.warn({ botId: bot.id, chatRef }, 'bot_spam_control_drop');
        return;
      }
      const inline = caps.inlineButtons ? buttons : undefined;
      await provider.sendText(token, {
        chatRef,
        text: text.slice(0, 4000),
        ...(inline && inline.length ? { inlineButtons: inline } : {}),
      });
      await emitEvent({
        name: 'bot.message.sent',
        tenantId: bot.tenantId,
        subjectType: 'bot',
        subjectId: bot.id,
        props: { botId: bot.id, platform: bot.platform },
      });
    };
  };

  const respond = async (
    bot: BotRow,
    responseKind: 'TEXT' | 'BUTTONS' | 'AI' | 'WORKFLOW',
    payload: Record<string, unknown> | null,
    userText: string,
    chatRef: string,
    send: SendFn
  ): Promise<void> => {
    const text = typeof payload?.['text'] === 'string' ? (payload['text'] as string) : '';
    switch (responseKind) {
      case 'TEXT': {
        if (text) await send(chatRef, text);
        return;
      }
      case 'BUTTONS': {
        if (!text) return;
        await send(chatRef, text, coerceButtons(payload?.['buttons']));
        return;
      }
      case 'AI': {
        const custom = typeof payload?.['systemPrompt'] === 'string' ? (payload['systemPrompt'] as string) : '';
        const system = custom || bot.aiSystemPrompt || DEFAULT_AI_PROMPT_FA;
        try {
          // Direct provider call (30s timeout) — quota counted inside aiProviderComplete.
          const reply = await aiProviderComplete(bot.tenantId, system, userText.slice(0, 2000) || 'سلام');
          await send(chatRef, reply);
        } catch (err) {
          log.warn({ botId: bot.id, err: err instanceof Error ? err.message : 'ai_error' }, 'bot_ai_reply_failed');
          await send(chatRef, AI_FALLBACK_FA);
        }
        return;
      }
      case 'WORKFLOW': {
        const workflowId = typeof payload?.['workflowId'] === 'string' ? (payload['workflowId'] as string) : '';
        if (!workflowId) return;
        const db = getDb();
        const [wf] = await db
          .select()
          .from(workflows)
          .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, bot.tenantId), eq(workflows.isEnabled, 1)))
          .limit(1);
        if (!wf) return;
        await executeWorkflow(
          {
            workflowId: wf.id,
            tenantId: bot.tenantId,
            botId: bot.id,
            triggerKind: 'COMMAND',
            triggerRef: chatRef,
            variables: { chatRef, text: userText },
          },
          { platform: bot.platform as Platform, token: decryptSecret(bot.tokenEncrypted), aiSystemPrompt: bot.aiSystemPrompt },
          send
        );
        return;
      }
      default:
        return;
    }
  };

  const handleText = async (bot: BotRow, text: string, chatRef: string, send: SendFn): Promise<void> => {
    const db = getDb();
    const trimmed = text.trim();

    // 1) command match
    if (trimmed.startsWith('/')) {
      let cmd = trimmed.toLowerCase().split(/\s+/)[0] ?? '';
      const at = cmd.indexOf('@');
      if (at > 0) cmd = cmd.slice(0, at);
      const [command] = await db
        .select()
        .from(botCommands)
        .where(and(eq(botCommands.botId, bot.id), eq(botCommands.command, cmd), eq(botCommands.isEnabled, 1)))
        .limit(1);
      if (command) {
        await respond(bot, command.responseKind, command.responsePayload ?? null, trimmed, chatRef, send);
        return;
      }
    }

    // 2) keyword match (EXACT / CONTAINS)
    const keywords = await db
      .select()
      .from(botKeywords)
      .where(and(eq(botKeywords.botId, bot.id), eq(botKeywords.isEnabled, 1)));
    const lower = trimmed.toLowerCase();
    const hit = keywords.find((k) =>
      k.matchKind === 'EXACT'
        ? lower === k.keyword.trim().toLowerCase()
        : lower.includes(k.keyword.trim().toLowerCase())
    );
    if (hit) {
      await respond(bot, hit.responseKind, hit.responsePayload ?? null, trimmed, chatRef, send);
      return;
    }

    // 3) MESSAGE_RECEIVED workflows (bounded: at most 3 per message)
    const wfRows = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.botId, bot.id), eq(workflows.isEnabled, 1)))
      .limit(3);
    const token = decryptSecret(bot.tokenEncrypted);
    for (const wf of wfRows) {
      const def = wf.definitionJson as { trigger?: { kind?: unknown; keyword?: unknown } } | null;
      if (!def || def.trigger?.kind !== 'MESSAGE_RECEIVED') continue;
      const kw = typeof def.trigger.keyword === 'string' ? def.trigger.keyword.trim().toLowerCase() : '';
      if (kw && !lower.includes(kw)) continue;
      await executeWorkflow(
        {
          workflowId: wf.id,
          tenantId: bot.tenantId,
          botId: bot.id,
          triggerKind: 'MESSAGE_RECEIVED',
          triggerRef: chatRef,
          variables: { chatRef, text: trimmed },
        },
        { platform: bot.platform as Platform, token, aiSystemPrompt: bot.aiSystemPrompt },
        send
      );
    }
  };

  const processor = async (job: Job): Promise<void> => {
    const data = job.data as { eventId?: unknown };
    if (typeof data.eventId !== 'string') return;
    const db = getDb();

    const [event] = await db.select().from(botEvents).where(eq(botEvents.id, data.eventId)).limit(1);
    if (!event || event.state !== 'PENDING') return; // idempotent replay guard

    const [bot] = await db.select().from(bots).where(eq(bots.id, event.botId)).limit(1);

    try {
      if (!bot || bot.status !== 'ACTIVE') {
        await db
          .update(botEvents)
          .set({ state: 'PROCESSED', processedAt: new Date() })
          .where(eq(botEvents.id, event.id));
        return;
      }

      const msg = extractBotMessage(event.payloadJson);

      if (!msg || !msg.chatId) {
        await db
          .update(botEvents)
          .set({ state: 'PROCESSED', processedAt: new Date() })
          .where(eq(botEvents.id, event.id));
        return;
      }

      await emitEvent({
        name: 'bot.message.received',
        tenantId: bot.tenantId,
        subjectType: 'bot',
        subjectId: bot.id,
        props: { botId: bot.id, platform: bot.platform },
      });

      // upsert bot_users (first/last seen)
      if (msg.senderId) {
        const now = new Date();
        await db
          .insert(botUsers)
          .values({
            id: newId(),
            botId: bot.id,
            platformUserId: msg.senderId,
            username: msg.username,
            displayName: msg.displayName,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .onDuplicateKeyUpdate({
            set: {
              lastSeenAt: now,
              ...(msg.username ? { username: msg.username } : {}),
              ...(msg.displayName ? { displayName: msg.displayName } : {}),
            },
          });
      }

      const send = makeSend(bot, decryptSecret(bot.tokenEncrypted));
      await handleText(bot, msg.text, msg.chatId, send);

      await db
        .update(botEvents)
        .set({ state: 'PROCESSED', processedAt: new Date() })
        .where(eq(botEvents.id, event.id));
    } catch (err) {
      log.error({ eventId: event.id, err: err instanceof Error ? err.message : 'bot_event_error' }, 'bot_event_failed');
      await db
        .update(botEvents)
        .set({ state: 'FAILED', processedAt: new Date() })
        .where(eq(botEvents.id, event.id))
        .catch(() => undefined);
      if (shouldNotify(bot?.id ?? event.id)) {
        await notifyTenant({
          tenantId: event.tenantId,
          kind: 'BOT_EVENT_FAILED',
          titleFa: 'خطا در پردازش پیام ربات',
          bodyFa: `ربات «${bot?.title ?? ''}» در پردازش یکی از پیام‌ها خطا داشت. تنظیمات ربات را بررسی کنید.`,
        }).catch(() => undefined);
      }
    }
  };

  return createWorker(
    'bot-events',
    processor as unknown as Parameters<typeof createWorker>[1],
    { concurrency: 2 }
  );
}
