import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import {
  bots, botUsers, botCommands, botKeywords, botEvents, events,
} from '../../db/schema.js';
import { newId, newToken, sha256Hex, timingSafeEqualStr } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { emitEvent } from '../../core/events.js';
import { audit } from '../../core/audit.js';
import { encryptSecret, decryptSecret, maskSecret } from '../../security/encryption.js';
import { getProvider } from '../../providers/index.js';
import type { Platform } from '../../providers/types.js';
import { loadEnv } from '../../config/env.js';
import { enqueue } from '../../queue/queues.js';
import { assertWithinLimit } from '../subscriptions/plan.service.js';

/**
 * Bot lifecycle (ADR-0008): tokens are AES-256-GCM encrypted at rest (§92),
 * only masked values ever leave the service (§93), verification goes through
 * the platform provider, and webhook mode registers a secret-protected URL.
 */

type BotRow = typeof bots.$inferSelect;

export interface BotPublic {
  id: string;
  platform: Platform;
  title: string;
  username: string | null;
  status: string;
  mode: string;
  tokenMasked: string;
  aiEnabled: boolean;
  aiSystemPrompt: string | null;
  lastEventAt: Date | null;
  healthJson: Record<string, unknown> | null;
  createdAt: Date;
}

function toPublicBot(row: BotRow): BotPublic {
  return {
    id: row.id,
    platform: row.platform,
    title: row.title,
    username: row.username,
    status: row.status,
    mode: row.mode,
    tokenMasked: row.tokenMasked,
    aiEnabled: row.aiEnabled === 1,
    aiSystemPrompt: row.aiSystemPrompt,
    lastEventAt: row.lastEventAt,
    healthJson: row.healthJson ?? null,
    createdAt: row.createdAt,
  };
}

/** Map a classified ProviderError to the Persian-safe AppError contract (§114). */
export function mapProviderError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const cls = (err as { providerClass?: unknown }).providerClass;
  if (typeof cls !== 'string') return new AppError(ERR.PROVIDER_UNAVAILABLE());
  const rawMsg = (err as { userMessageFa?: unknown }).userMessageFa;
  const fa = typeof rawMsg === 'string' ? rawMsg : undefined;
  switch (cls) {
    case 'UNAUTHORIZED':
      return new AppError(ERR.PROVIDER_UNAUTHORIZED());
    case 'RATE_LIMITED':
      return new AppError(ERR.PROVIDER_RATE_LIMITED());
    case 'TRANSIENT':
      return new AppError(ERR.PROVIDER_UNAVAILABLE());
    case 'NOT_FOUND':
      return new AppError(ERR.VALIDATION(fa ?? 'ربات یا مقصد در پلتفرم یافت نشد.'));
    case 'BLOCKED':
      return new AppError(ERR.VALIDATION(fa ?? 'دسترسی ربات به مقصد مسدود است.'));
    case 'VALIDATION':
      return new AppError(ERR.VALIDATION(fa));
    default:
      return new AppError(ERR.PROVIDER_UNAVAILABLE());
  }
}

export async function getOwnedBot(tenantId: string, botId: string): Promise<BotRow> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(bots)
    .where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('ربات'));
  return row;
}

// ---------- listing / connection ----------

export async function listBots(tenantId: string): Promise<BotPublic[]> {
  const db = getDb();
  const rows = await db.select().from(bots).where(eq(bots.tenantId, tenantId)).orderBy(desc(bots.createdAt));
  return rows.map(toPublicBot); // never exposes tokenEncrypted/webhookSecret (§93)
}

export async function connectBot(
  tenantId: string,
  input: { platform: Platform; token: string; title?: string }
): Promise<BotPublic> {
  await assertWithinLimit(tenantId, 'bots');
  const provider = getProvider(input.platform);
  const identity = await provider.verifyBot(input.token).catch((err: unknown) => {
    throw mapProviderError(err);
  });

  const db = getDb();
  const id = newId();
  const now = new Date();
  await db.insert(bots).values({
    id,
    tenantId,
    platform: input.platform,
    tokenEncrypted: encryptSecret(input.token),
    tokenMasked: maskSecret(input.token),
    username: identity.username,
    title: (input.title?.trim() || identity.title || 'ربات').slice(0, 190),
    status: 'ACTIVE',
    mode: 'POLLING',
    webhookSecret: provider.capabilities().webhook ? newToken(24) : null,
    healthJson: { verify: 'ok', verifiedAt: now.toISOString() },
  });
  const created = await getOwnedBot(tenantId, id);

  await emitEvent({
    name: 'bot.created',
    tenantId,
    subjectType: 'bot',
    subjectId: id,
    props: { platform: input.platform },
  });
  await audit({ action: 'bot.connect', actorId: tenantId, subjectType: 'bot', subjectId: id, meta: { platform: input.platform } });
  return toPublicBot(created);
}

export async function verifyBot(
  tenantId: string,
  botId: string
): Promise<{ username: string | null; title: string }> {
  const bot = await getOwnedBot(tenantId, botId);
  const provider = getProvider(bot.platform);
  const identity = await provider.verifyBot(decryptSecret(bot.tokenEncrypted)).catch((err: unknown) => {
    throw mapProviderError(err);
  });
  const db = getDb();
  await db
    .update(bots)
    .set({
      username: identity.username,
      healthJson: { ...((bot.healthJson ?? {}) as Record<string, unknown>), verify: 'ok', verifiedAt: new Date().toISOString() },
    })
    .where(eq(bots.id, bot.id));
  await audit({ action: 'bot.verify', actorId: tenantId, subjectType: 'bot', subjectId: bot.id });
  return { username: identity.username, title: identity.title };
}

export async function enableBot(tenantId: string, botId: string): Promise<BotPublic> {
  const bot = await getOwnedBot(tenantId, botId);
  const provider = getProvider(bot.platform);
  const token = decryptSecret(bot.tokenEncrypted);

  let webhookSecret = bot.webhookSecret;
  let webhookUrl = bot.webhookUrl;
  let webhookRegisteredAt = bot.webhookRegisteredAt;

  if (bot.mode === 'WEBHOOK' && provider.capabilities().webhook && typeof provider.setWebhook === 'function') {
    if (!webhookSecret) webhookSecret = newToken(24);
    const url = `${loadEnv().API_URL}/api/v1/webhooks/bots/${bot.id}?s=${webhookSecret}`;
    await provider.setWebhook(token, url, webhookSecret).catch((err: unknown) => {
      throw mapProviderError(err);
    });
    webhookUrl = url.slice(0, 255);
    webhookRegisteredAt = new Date();
  }

  const db = getDb();
  await db
    .update(bots)
    .set({
      status: 'ACTIVE',
      webhookSecret,
      webhookUrl,
      webhookRegisteredAt,
      healthJson: { ...((bot.healthJson ?? {}) as Record<string, unknown>), lastEnable: new Date().toISOString() },
    })
    .where(eq(bots.id, bot.id));

  await emitEvent({ name: 'bot.enabled', tenantId, subjectType: 'bot', subjectId: bot.id });
  await audit({ action: 'bot.enable', actorId: tenantId, subjectType: 'bot', subjectId: bot.id });
  return toPublicBot(await getOwnedBot(tenantId, botId));
}

export async function disableBot(tenantId: string, botId: string): Promise<BotPublic> {
  const bot = await getOwnedBot(tenantId, botId);
  const provider = getProvider(bot.platform);

  // Best-effort webhook removal where the platform supports it (§16).
  if (provider.capabilities().webhook && typeof provider.deleteWebhook === 'function') {
    await provider.deleteWebhook(decryptSecret(bot.tokenEncrypted)).catch(() => undefined);
  }

  const db = getDb();
  await db.update(bots).set({ status: 'DISABLED' }).where(eq(bots.id, bot.id));
  await emitEvent({ name: 'bot.disabled', tenantId, subjectType: 'bot', subjectId: bot.id });
  await audit({ action: 'bot.disable', actorId: tenantId, subjectType: 'bot', subjectId: bot.id });
  return toPublicBot(await getOwnedBot(tenantId, botId));
}

export async function setBotMode(tenantId: string, botId: string, mode: 'WEBHOOK' | 'POLLING'): Promise<BotPublic> {
  const bot = await getOwnedBot(tenantId, botId);
  const provider = getProvider(bot.platform);
  const db = getDb();

  let webhookSecret = bot.webhookSecret;
  let webhookUrl = bot.webhookUrl;
  let webhookRegisteredAt = bot.webhookRegisteredAt;

  // An ACTIVE bot switched to WEBHOOK mode registers its webhook right away
  // (best-effort) so it is never left silently unreachable.
  if (mode === 'WEBHOOK' && bot.status === 'ACTIVE' && provider.capabilities().webhook && typeof provider.setWebhook === 'function') {
    try {
      if (!webhookSecret) webhookSecret = newToken(24);
      const url = `${loadEnv().API_URL}/api/v1/webhooks/bots/${bot.id}?s=${webhookSecret}`;
      await provider.setWebhook(decryptSecret(bot.tokenEncrypted), url, webhookSecret);
      webhookUrl = url.slice(0, 255);
      webhookRegisteredAt = new Date();
    } catch {
      webhookRegisteredAt = null; // retried on next enable
    }
  }

  await db.update(bots).set({ mode, webhookSecret, webhookUrl, webhookRegisteredAt }).where(eq(bots.id, bot.id));
  await audit({ action: 'bot.mode', actorId: tenantId, subjectType: 'bot', subjectId: bot.id, meta: { mode } });
  return toPublicBot(await getOwnedBot(tenantId, botId));
}

export async function updateAiSettings(
  tenantId: string,
  botId: string,
  input: { aiEnabled: boolean; aiSystemPrompt?: string | null }
): Promise<BotPublic> {
  const bot = await getOwnedBot(tenantId, botId);
  const db = getDb();
  await db
    .update(bots)
    .set({
      aiEnabled: input.aiEnabled ? 1 : 0,
      aiSystemPrompt: input.aiSystemPrompt === undefined ? bot.aiSystemPrompt : input.aiSystemPrompt,
    })
    .where(eq(bots.id, bot.id));
  await audit({
    action: 'bot.ai_settings',
    actorId: tenantId,
    subjectType: 'bot',
    subjectId: bot.id,
    meta: { aiEnabled: input.aiEnabled },
  });
  return toPublicBot(await getOwnedBot(tenantId, botId));
}

/** Internal use only (worker/delivery) — never exposed through HTTP. */
export async function getBotToken(tenantId: string, botId: string): Promise<string> {
  const bot = await getOwnedBot(tenantId, botId);
  return decryptSecret(bot.tokenEncrypted);
}

// ---------- users / stats ----------

export async function listBotUsers(
  tenantId: string,
  botId: string,
  page: number,
  pageSize: number
): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  await getOwnedBot(tenantId, botId);
  const db = getDb();
  const offset = (page - 1) * pageSize;
  const items = await db
    .select({
      id: botUsers.id,
      platformUserId: botUsers.platformUserId,
      username: botUsers.username,
      displayName: botUsers.displayName,
      firstSeenAt: botUsers.firstSeenAt,
      lastSeenAt: botUsers.lastSeenAt,
    })
    .from(botUsers)
    .where(eq(botUsers.botId, botId))
    .orderBy(desc(botUsers.lastSeenAt))
    .limit(pageSize)
    .offset(offset);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botUsers)
    .where(eq(botUsers.botId, botId));
  return { items, total: Number(countRow?.count ?? 0), page, pageSize };
}

export async function getBotStats(
  tenantId: string,
  botId: string
): Promise<{ eventsByKind: Array<{ kind: string; count: number }>; messagesSent30d: number; userCount: number }> {
  const bot = await getOwnedBot(tenantId, botId);
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const kindRows = await db
    .select({ kind: botEvents.kind, count: sql<number>`count(*)` })
    .from(botEvents)
    .where(and(eq(botEvents.botId, bot.id), gte(botEvents.createdAt, since)))
    .groupBy(botEvents.kind);

  const [sentRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        eq(events.name, 'bot.message.sent'),
        eq(events.tenantId, tenantId),
        gte(events.createdAt, since),
        sql`json_extract(${events.propsJson}, '$.botId') = ${bot.id}`
      )
    );

  const [userRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botUsers)
    .where(eq(botUsers.botId, bot.id));

  return {
    eventsByKind: kindRows.map((r) => ({ kind: r.kind, count: Number(r.count ?? 0) })),
    messagesSent30d: Number(sentRow?.count ?? 0),
    userCount: Number(userRow?.count ?? 0),
  };
}

// ---------- commands ----------

export function normalizeCommandName(raw: string): string {
  let cmd = raw.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const at = cmd.indexOf('@');
  if (at > 0) cmd = cmd.slice(0, at);
  if (!cmd.startsWith('/')) cmd = `/${cmd}`;
  return cmd;
}

export type BotResponsePayload = {
  text?: string;
  buttons?: Array<{ label: string; url?: string; callback?: string }>;
  systemPrompt?: string;
  workflowId?: string;
};

export async function listBotCommands(tenantId: string, botId: string) {
  await getOwnedBot(tenantId, botId);
  return getDb()
    .select()
    .from(botCommands)
    .where(eq(botCommands.botId, botId))
    .orderBy(botCommands.createdAt);
}

export async function createBotCommand(
  tenantId: string,
  botId: string,
  input: { command: string; descriptionFa?: string; responseKind: 'TEXT' | 'BUTTONS' | 'AI' | 'WORKFLOW'; responsePayload?: BotResponsePayload | null }
) {
  await getOwnedBot(tenantId, botId);
  const command = normalizeCommandName(input.command);
  if (!/^\/[a-z0-9_]{1,31}$/.test(command)) {
    throw new AppError(ERR.VALIDATION('دستور باید با «/» و حروف لاتین، عدد یا زیرخط باشد.'));
  }
  const db = getDb();
  const id = newId();
  await db
    .insert(botCommands)
    .values({
      id,
      botId,
      tenantId,
      command,
      descriptionFa: input.descriptionFa ?? '',
      responseKind: input.responseKind,
      responsePayload: input.responsePayload ?? null,
    })
    .catch((err: unknown) => {
      // ER_DUP_ENTRY (1062) → user-facing duplicate; anything else rethrown as-is.
      if ((err as { errno?: number } | null)?.errno === 1062) throw new AppError(ERR.DUPLICATE('این دستور'));
      throw err;
    });
  await audit({ action: 'bot.command.create', actorId: tenantId, subjectType: 'bot_command', subjectId: id, meta: { command } });
  const [row] = await db.select().from(botCommands).where(eq(botCommands.id, id)).limit(1);
  return row;
}

export async function updateBotCommand(
  tenantId: string,
  commandId: string,
  patch: { command?: string; descriptionFa?: string; responseKind?: 'TEXT' | 'BUTTONS' | 'AI' | 'WORKFLOW'; responsePayload?: BotResponsePayload | null; isEnabled?: boolean }
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(botCommands)
    .where(and(eq(botCommands.id, commandId), eq(botCommands.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('دستور'));
  const command = patch.command !== undefined ? normalizeCommandName(patch.command) : undefined;
  if (command !== undefined && !/^\/[a-z0-9_]{1,31}$/.test(command)) {
    throw new AppError(ERR.VALIDATION('دستور باید با «/» و حروف لاتین، عدد یا زیرخط باشد.'));
  }
  await db
    .update(botCommands)
    .set({
      ...(command !== undefined ? { command } : {}),
      ...(patch.descriptionFa !== undefined ? { descriptionFa: patch.descriptionFa } : {}),
      ...(patch.responseKind !== undefined ? { responseKind: patch.responseKind } : {}),
      ...(patch.responsePayload !== undefined ? { responsePayload: patch.responsePayload } : {}),
      ...(patch.isEnabled !== undefined ? { isEnabled: patch.isEnabled ? 1 : 0 } : {}),
    })
    .where(eq(botCommands.id, commandId));
  await audit({ action: 'bot.command.update', actorId: tenantId, subjectType: 'bot_command', subjectId: commandId });
  const [updated] = await db.select().from(botCommands).where(eq(botCommands.id, commandId)).limit(1);
  return updated;
}

export async function deleteBotCommand(tenantId: string, commandId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: botCommands.id })
    .from(botCommands)
    .where(and(eq(botCommands.id, commandId), eq(botCommands.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('دستور'));
  await db.delete(botCommands).where(eq(botCommands.id, commandId));
  await audit({ action: 'bot.command.delete', actorId: tenantId, subjectType: 'bot_command', subjectId: commandId });
}

// ---------- keywords ----------

export async function listBotKeywords(tenantId: string, botId: string) {
  await getOwnedBot(tenantId, botId);
  return getDb()
    .select()
    .from(botKeywords)
    .where(eq(botKeywords.botId, botId))
    .orderBy(botKeywords.createdAt);
}

export async function createBotKeyword(
  tenantId: string,
  botId: string,
  input: { keyword: string; matchKind: 'EXACT' | 'CONTAINS'; responseKind: 'TEXT' | 'BUTTONS' | 'AI' | 'WORKFLOW'; responsePayload?: BotResponsePayload | null }
) {
  await getOwnedBot(tenantId, botId);
  const keyword = input.keyword.trim();
  if (keyword.length < 2) throw new AppError(ERR.VALIDATION('کلمهٔ کلیدی باید حداقل ۲ نویسه باشد.'));
  const db = getDb();
  const id = newId();
  await db.insert(botKeywords).values({
    id,
    botId,
    tenantId,
    keyword: keyword.slice(0, 190),
    matchKind: input.matchKind,
    responseKind: input.responseKind,
    responsePayload: input.responsePayload ?? null,
  });
  await audit({ action: 'bot.keyword.create', actorId: tenantId, subjectType: 'bot_keyword', subjectId: id });
  const [row] = await db.select().from(botKeywords).where(eq(botKeywords.id, id)).limit(1);
  return row;
}

export async function updateBotKeyword(
  tenantId: string,
  keywordId: string,
  patch: { keyword?: string; matchKind?: 'EXACT' | 'CONTAINS'; responseKind?: 'TEXT' | 'BUTTONS' | 'AI' | 'WORKFLOW'; responsePayload?: BotResponsePayload | null; isEnabled?: boolean }
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(botKeywords)
    .where(and(eq(botKeywords.id, keywordId), eq(botKeywords.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کلمهٔ کلیدی'));
  if (patch.keyword !== undefined && patch.keyword.trim().length < 2) {
    throw new AppError(ERR.VALIDATION('کلمهٔ کلیدی باید حداقل ۲ نویسه باشد.'));
  }
  await db
    .update(botKeywords)
    .set({
      ...(patch.keyword !== undefined ? { keyword: patch.keyword.trim().slice(0, 190) } : {}),
      ...(patch.matchKind !== undefined ? { matchKind: patch.matchKind } : {}),
      ...(patch.responseKind !== undefined ? { responseKind: patch.responseKind } : {}),
      ...(patch.responsePayload !== undefined ? { responsePayload: patch.responsePayload } : {}),
      ...(patch.isEnabled !== undefined ? { isEnabled: patch.isEnabled ? 1 : 0 } : {}),
    })
    .where(eq(botKeywords.id, keywordId));
  await audit({ action: 'bot.keyword.update', actorId: tenantId, subjectType: 'bot_keyword', subjectId: keywordId });
  const [updated] = await db.select().from(botKeywords).where(eq(botKeywords.id, keywordId)).limit(1);
  return updated;
}

export async function deleteBotKeyword(tenantId: string, keywordId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: botKeywords.id })
    .from(botKeywords)
    .where(and(eq(botKeywords.id, keywordId), eq(botKeywords.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('کلمهٔ کلیدی'));
  await db.delete(botKeywords).where(eq(botKeywords.id, keywordId));
  await audit({ action: 'bot.keyword.delete', actorId: tenantId, subjectType: 'bot_keyword', subjectId: keywordId });
}

// ---------- provider capabilities ----------

export async function getBotCapabilities(tenantId: string, botId: string) {
  const bot = await getOwnedBot(tenantId, botId);
  return getProvider(bot.platform).capabilities();
}

// ---------- public webhook ingestion (§187) ----------

export interface ExtractedBotMessage {
  text: string;
  chatId: string | null;
  senderId: string | null;
  username: string | null;
  displayName: string | null;
}

interface TgMessageLike {
  text?: unknown;
  caption?: unknown;
  chat?: { id?: unknown } | undefined;
  chat_id?: unknown;
  from?: { id?: unknown; username?: unknown; first_name?: unknown; last_name?: unknown } | undefined;
  from_id?: unknown;
  sender?: { chat_id?: unknown; sender_id?: unknown } | undefined;
}

function asId(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.length > 0 && v.length <= 190) return v;
  return null;
}

/** Tolerant extractor for Telegram/Bale update shapes and Rubika-like payloads. */
export function extractBotMessage(payload: unknown): ExtractedBotMessage | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const msgRaw = root['message'] ?? root['edited_message'] ?? root;
  if (!msgRaw || typeof msgRaw !== 'object') return null;
  const msg = msgRaw as TgMessageLike;
  const text = typeof msg.text === 'string' ? msg.text : typeof msg.caption === 'string' ? msg.caption : '';
  const chatId = asId(msg.chat?.id) ?? asId(msg.chat_id) ?? asId(msg.sender?.chat_id);
  const senderId = asId(msg.from?.id) ?? asId(msg.from_id) ?? asId(msg.sender?.sender_id);
  const username = typeof msg.from?.username === 'string' ? msg.from.username.slice(0, 190) : null;
  const first = typeof msg.from?.first_name === 'string' ? msg.from.first_name : '';
  const last = typeof msg.from?.last_name === 'string' ? msg.from.last_name : '';
  const displayName = `${first} ${last}`.trim().slice(0, 190) || null;
  if (!chatId && !senderId && !text) return null;
  return { text, chatId, senderId, username, displayName };
}

/**
 * Ingest a provider webhook update (§187): secret-validated, deduplicated by
 * (botId, dedupHash) unique key, then enqueued exactly-once. Never throws to
 * the provider — the route always answers {success:true}.
 */
export async function ingestBotWebhook(botId: string, secretParam: unknown, body: unknown): Promise<void> {
  const db = getDb();
  const [bot] = await db
    .select({ id: bots.id, tenantId: bots.tenantId, platform: bots.platform, mode: bots.mode, webhookSecret: bots.webhookSecret })
    .from(bots)
    .where(eq(bots.id, botId))
    .limit(1);
  if (!bot || bot.mode !== 'WEBHOOK' || !bot.webhookSecret) return;

  const secret = typeof secretParam === 'string' ? secretParam : '';
  if (!secret || !timingSafeEqualStr(secret, bot.webhookSecret)) return;

  let update = body;
  if (typeof update === 'string') {
    try {
      update = JSON.parse(update) as unknown;
    } catch {
      return;
    }
  }
  if (!update || typeof update !== 'object' || Array.isArray(update)) return;

  const updateId = (update as { update_id?: unknown }).update_id;
  const hashSeed = updateId !== undefined && updateId !== null ? updateId : update;
  const dedupHash = await sha256Hex(bot.id + JSON.stringify(hashSeed));

  const msg = extractBotMessage(update);
  const eventId = newId();
  const res = await db
    .insert(botEvents)
    .values({
      id: eventId,
      tenantId: bot.tenantId,
      botId: bot.id,
      platform: bot.platform,
      externalId: asId(updateId),
      dedupHash,
      kind: msg ? 'message' : 'update',
      chatRef: msg?.chatId ?? null,
      senderRef: msg?.senderId ?? null,
      payloadJson: update,
    })
    .onDuplicateKeyUpdate({ set: { dedupHash: sql`${botEvents.dedupHash}` } }); // INSERT IGNORE semantics

  const header = Array.isArray(res) ? res[0] : res;
  const affected = (header as { affectedRows?: number } | undefined)?.affectedRows ?? 0;
  if (affected === 0) return; // duplicate — already enqueued once

  await db.update(bots).set({ lastEventAt: new Date() }).where(eq(bots.id, bot.id));
  await enqueue('bot-events', 'process', { eventId }, { jobId: `botev:${eventId}` });
}
