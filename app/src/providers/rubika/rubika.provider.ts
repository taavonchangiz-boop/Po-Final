/**
 * Rubika provider — https://botapi.rubika.ir/bot{token}.
 *
 * Rubika exposes its own bot API (Telegram-flavoured but NOT identical).
 * Where the upstream request/response shape differs from the Bot-API standard,
 * the difference is encapsulated HERE — callers only ever see the Postyar
 * provider interfaces. This adapter NEVER throws raw provider errors; every
 * failure is returned as a SendOutcome / {ok:false} result so the delivery
 * state machine can classify and retry safely.
 *
 * Capability deltas (documented, ADR-009):
 *  - editMessage:   false (no upstream method)
 *  - deleteMessage: false (no upstream method)
 *  - webhookRegistration: false — Rubika does NOT support outgoing webhooks;
 *    ingestion is POLLING-ONLY via getUpdates (worker bot-polling loop).
 */
import { classifyHttpError, classifyProviderError, type ErrorClass } from '../../core/errors.js';
import { fetchWithTimeout } from '../../core/http.js';
import { logger } from '../../core/logger.js';
import type { BotProvider, ChannelProvider, ProviderButton, ProviderCapabilities, ProviderKind, SendOutcome, UpdateEnvelope } from '../types.js';

const RUBIKA_BASE = 'https://botapi.rubika.ir/bot';
const TIMEOUT_MS = 15_000;

const CAPABILITIES: ProviderCapabilities = {
  sendText: true,
  sendMedia: true,
  editMessage: false,
  deleteMessage: false,
  buttons: true,
  webhookRegistration: false, // POLLING only — see module comment.
  updateRetrieval: true,
  botIdentity: true,
  healthCheck: true,
};

const SAFE = {
  sendFailed: 'ارسال به روبیکا ناموفق بود.',
};

interface RubikaEnvelope<T> {
  ok?: boolean;
  status?: string;
  result?: T;
  data?: T;
  error_code?: number;
  description?: string;
  message?: string;
}

interface RubikaUser {
  id?: string | number;
  username?: string;
  first_name?: string;
  title?: string;
  name?: string;
}

interface RubikaUpdateMessage {
  message_id?: string | number;
  text?: string;
  time?: number;
  sender_type?: string;
  sender_id?: string | number;
  chat_id?: string | number;
  aux_data?: Record<string, unknown>;
}

interface RubikaUpdate {
  update_id?: string | number;
  chat_id?: string | number;
  type?: string;
  new_message?: RubikaUpdateMessage;
  removed_message?: RubikaUpdateMessage;
  updated_message?: RubikaUpdateMessage;
}

/** Map ProviderButton rows to Rubika's inline-keyboard metadata shape. */
function toRubikaMetadata(buttons?: ProviderButton[][]): Record<string, unknown> | undefined {
  if (buttons === undefined || buttons.length === 0) return undefined;
  return {
    rows: buttons.map((row) => ({
      buttons: row.map((b) => {
        if (b.url !== undefined) {
          return { button_text: b.text, type: 'Link', button_url: b.url };
        }
        return { button_text: b.text, type: 'Simple', button_payload: b.callbackData ?? b.text };
      }),
    })),
  };
}

function clip(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.slice(0, max);
}

export class RubikaProvider implements BotProvider, ChannelProvider {
  readonly kind: ProviderKind = 'RUBIKA';
  readonly capabilities: ProviderCapabilities = CAPABILITIES;
  private readonly baseUrl: string;

  constructor(token: string) {
    this.baseUrl = `${RUBIKA_BASE}${token}`;
  }

  /** Raw call — never throws; normalizes Rubika's envelope to {ok,result}. */
  private async call<T>(method: string, body: Record<string, unknown>): Promise<{ ok: true; result: T } | { ok: false; errorCode?: number; description?: string; network?: boolean }> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, TIMEOUT_MS);
      const json = (await res.json().catch(() => ({}))) as RubikaEnvelope<T>;
      const ok = json.ok === true || json.status === 'OK';
      if (res.ok && ok) return { ok: true, result: (json.result ?? json.data ?? ({} as T)) };
      const code = json.error_code ?? res.status;
      const description = json.description ?? json.message ?? `HTTP ${res.status}`;
      logger.warn('provider_call_failed', { kind: 'RUBIKA', method, error: description });
      return { ok: false, errorCode: code, description };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('provider_call_failed', { kind: 'RUBIKA', method, error: msg });
      return { ok: false, description: msg, network: true };
    }
  }

  private sendFailure(description: string | undefined, errorCode: number | undefined, network: boolean | undefined): SendOutcome {
    const errorClass: ErrorClass = network
      ? classifyProviderError(new Error(description ?? 'network failure'))
      : errorCode === 429
        ? 'RateLimited'
        : errorCode !== undefined
          ? classifyHttpError(errorCode)
          : 'Transient';
    return {
      ok: false,
      errorClass,
      safeMessage: SAFE.sendFailed,
      detail: description !== undefined ? `${errorCode ?? '?'}: ${description}` : String(errorCode ?? 'unknown'),
    };
  }

  /* ------------------------------ BotProvider ----------------------------- */

  async getMe(): Promise<{ ok: boolean; id?: string; username?: string; title?: string; error?: string }> {
    const res = await this.call<RubikaUser>('getMe', {});
    if (!res.ok) return { ok: false, error: res.description };
    return {
      ok: true,
      id: res.result.id !== undefined ? String(res.result.id) : undefined,
      username: res.result.username,
      title: res.result.title ?? res.result.name ?? res.result.first_name,
    };
  }

  async setWebhook(_url: string, _secret: string): Promise<{ ok: boolean; error?: string }> {
    // Rubika does not support webhooks — bots are ingested by polling (see
    // modules/bots/bot-polling.ts). Registration is refused at the adapter.
    return { ok: false, error: 'روبیکا از وب‌هوک پشتیبانی نمی‌کند؛ دریافت پیام‌ها با polling انجام می‌شود.' };
  }

  async deleteWebhook(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: 'روبیکا از وب‌هوک پشتیبانی نمی‌کند.' };
  }

  async getUpdates(offset: number): Promise<{ ok: boolean; updates?: UpdateEnvelope[]; error?: string }> {
    // Rubika's own getUpdates shape: `offset` carries the last update id and
    // (optionally) a chat filter via `chat_id`. We pass the numeric offset and
    // sanitize every field we surface (strings clipped, raw preserved).
    const res = await this.call<{ updates?: RubikaUpdate[] } | RubikaUpdate[]>('getUpdates', {
      offset: { update_id: offset },
      limit: 50,
      timeout: 0,
    });
    if (!res.ok) return { ok: false, error: res.description };
    const list: RubikaUpdate[] = Array.isArray(res.result) ? res.result : (res.result.updates ?? []);
    const updates: UpdateEnvelope[] = [];
    for (const u of list) {
      const updateId = u.update_id;
      if (updateId === undefined) continue;
      const raw = u as unknown as Record<string, unknown>;
      const msg = u.new_message ?? u.updated_message;
      if (msg !== undefined) {
        const chatId = msg.chat_id ?? u.chat_id;
        updates.push({
          externalEventId: String(updateId),
          type: u.new_message !== undefined ? 'message' : 'edited_message',
          chatId: chatId !== undefined ? clip(String(chatId), 64) : undefined,
          senderRef: msg.sender_id !== undefined ? clip(String(msg.sender_id), 64) : undefined,
          text: clip(msg.text, 4000),
          raw,
        });
      } else if (u.removed_message !== undefined) {
        const chatId = u.removed_message.chat_id ?? u.chat_id;
        updates.push({
          externalEventId: String(updateId),
          type: 'message_deleted',
          chatId: chatId !== undefined ? clip(String(chatId), 64) : undefined,
          raw,
        });
      } else {
        updates.push({ externalEventId: String(updateId), type: clip(u.type, 40) ?? 'other', chatId: u.chat_id !== undefined ? clip(String(u.chat_id), 64) : undefined, raw });
      }
    }
    return { ok: true, updates };
  }

  async sendMessage(chatId: string, text: string, buttons?: ProviderButton[][]): Promise<SendOutcome> {
    const metadata = toRubikaMetadata(buttons);
    const res = await this.call<{ message_id?: string | number }>('sendMessage', {
      chat_id: chatId,
      text,
      ...(metadata !== undefined ? { metadata } : {}),
    });
    if (!res.ok) return this.sendFailure(res.description, res.errorCode, res.network);
    return { ok: true, messageId: res.result.message_id !== undefined ? String(res.result.message_id) : '' };
  }

  /* ---------------------------- ChannelProvider --------------------------- */

  async verifyChat(chatId: string): Promise<{ ok: boolean; title?: string; username?: string; error?: string }> {
    const res = await this.call<RubikaUser & { title?: string }>('getChat', { chat_id: chatId });
    if (!res.ok) return { ok: false, error: res.description };
    return { ok: true, title: res.result.title ?? res.result.name, username: res.result.username };
  }

  async sendText(chatId: string, text: string, buttons?: ProviderButton[][]): Promise<SendOutcome> {
    return this.sendMessage(chatId, text, buttons);
  }

  async sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<SendOutcome> {
    // Photo delivered as a URL attachment (no multipart upload in the
    // Rubika bot API path we support).
    const res = await this.call<{ message_id?: string | number }>('sendPhoto', {
      chat_id: chatId,
      photo: photoUrl,
      ...(caption !== undefined ? { caption } : {}),
    });
    if (!res.ok) return this.sendFailure(res.description, res.errorCode, res.network);
    return { ok: true, messageId: res.result.message_id !== undefined ? String(res.result.message_id) : '' };
  }

  async editMessageText(_chatId: string, _messageId: string, _text: string): Promise<SendOutcome> {
    return {
      ok: false,
      errorClass: 'Permanent',
      safeMessage: SAFE.sendFailed,
      detail: 'RUBIKA: editMessage not supported (capability false)',
    };
  }

  async deleteMessage(_chatId: string, _messageId: string): Promise<SendOutcome> {
    return {
      ok: false,
      errorClass: 'Permanent',
      safeMessage: SAFE.sendFailed,
      detail: 'RUBIKA: deleteMessage not supported (capability false)',
    };
  }
}
