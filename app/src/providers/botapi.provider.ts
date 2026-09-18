/**
 * Shared implementation for Bot-API-compatible providers (Telegram / Bale).
 *
 * Both platforms expose the same HTTP contract: `POST {base}/{method}` with a
 * JSON body and reply `{ ok: boolean, result?: T, error_code?: number,
 * description?: string }`. Only the base URL differs:
 *   - Telegram: https://api.telegram.org/bot{token}
 *   - Bale:     https://tapi.bale.ai/bot{token}
 *
 * Error mapping (binding, per task spec):
 *   - 400 (bad request)        -> Validation      (never retry)
 *   - 401                      -> Authentication  (never retry)
 *   - 403                      -> Authorization   (never retry)
 *   - 429                      -> RateLimited     (retry w/ backoff)
 *   - other 4xx                -> Permanent       (never retry)
 *   - 5xx                      -> Transient       (retry w/ backoff)
 *   - fetch/network/timeout    -> Network/Transient (retry w/ backoff)
 *
 * `safeMessage` (Persian) is stored in DB / shown to the tenant; `detail`
 * (provider description) goes to SERVER LOGS ONLY — never returned to clients.
 */
import { classifyHttpError, classifyProviderError, type ErrorClass } from '../core/errors.js';
import { fetchWithTimeout } from '../core/http.js';
import { logger } from '../core/logger.js';
import type { BotProvider, ChannelProvider, ProviderButton, ProviderCapabilities, ProviderKind, SendOutcome, UpdateEnvelope } from './types.js';

const TIMEOUT_MS = 15_000;

/** All capabilities true — Telegram and Bale both support the full surface. */
export const FULL_CAPABILITIES: ProviderCapabilities = {
  sendText: true,
  sendMedia: true,
  editMessage: true,
  deleteMessage: true,
  buttons: true,
  // Bale caveat (audit F1): Bale's setWebhook does NOT honour `secret_token`
  // and its inbound webhook has no provider-side auth. Postyar compensates by
  // requiring its own `X-Postyar-Secret` header on /webhooks/bale/:botId.
  // Declared `true` here because registration itself succeeds on both.
  webhookRegistration: true,
  updateRetrieval: true,
  botIdentity: true,
  healthCheck: true,
};

interface ProviderLabels {
  displayName: string;
  sendFailed: string;
  editFailed: string;
  deleteFailed: string;
}

interface BotApiEnvelope<T> {
  ok?: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

interface TelegramUser {
  id?: number;
  username?: string;
  first_name?: string;
  title?: string;
}

interface TelegramChat {
  id?: number | string;
  title?: string;
  username?: string;
  type?: string;
}

interface TelegramMessage {
  message_id?: number;
  date?: number;
  text?: string;
  chat?: TelegramChat;
  from?: { id?: number; username?: string; first_name?: string };
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: {
    id?: number | string;
    data?: string;
    from?: { id?: number; username?: string; first_name?: string };
    message?: TelegramMessage;
  };
}

/** Map a Bot-API error_code to the delivery-retry ErrorClass (task mapping). */
export function mapBotApiErrorCode(errorCode: number | undefined): ErrorClass {
  if (errorCode === undefined) return 'Transient';
  if (errorCode === 429) return 'RateLimited'; // -> Transient-style retry with backoff
  if (errorCode === 401) return 'Authentication';
  if (errorCode === 403) return 'Authorization';
  if (errorCode === 400) return 'Validation';
  return classifyHttpError(errorCode);
}

function toProviderButtonRows(buttons?: ProviderButton[][]): { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> } | undefined {
  if (buttons === undefined || buttons.length === 0) return undefined;
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => {
        const btn: { text: string; url?: string; callback_data?: string } = { text: b.text };
        if (b.url !== undefined) btn.url = b.url;
        if (b.callbackData !== undefined) btn.callback_data = b.callbackData;
        return btn;
      }),
    ),
  };
}

export class BotApiCompatibleProvider implements BotProvider, ChannelProvider {
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  private readonly baseUrl: string;
  private readonly labels: ProviderLabels;

  constructor(kind: ProviderKind, baseUrl: string, capabilities: ProviderCapabilities, labels: ProviderLabels) {
    this.kind = kind;
    this.baseUrl = baseUrl;
    this.capabilities = capabilities;
    this.labels = labels;
  }

  /** Raw Bot-API call: POST JSON, parse {ok,result} envelope, never throws. */
  private async call<T>(method: string, body: Record<string, unknown>): Promise<{ ok: true; result: T } | { ok: false; errorCode?: number; description?: string; network?: boolean }> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, TIMEOUT_MS);
      const json = (await res.json().catch(() => ({}))) as BotApiEnvelope<T>;
      if (res.ok && json.ok === true) return { ok: true, result: (json.result ?? ({} as T)) };
      return { ok: false, errorCode: json.error_code ?? res.status, description: json.description ?? `HTTP ${res.status}` };
    } catch (err) {
      logger.warn('provider_call_failed', {
        kind: this.kind,
        method,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, description: err instanceof Error ? err.message : String(err), network: true };
    }
  }

  private failure(operation: 'send' | 'edit' | 'delete', errorCode: number | undefined, description: string | undefined, network: boolean | undefined): SendOutcome {
    if (network) {
      return {
        ok: false,
        errorClass: classifyProviderError(new Error(description ?? 'network failure')),
        safeMessage: operation === 'send' ? this.labels.sendFailed : operation === 'edit' ? this.labels.editFailed : this.labels.deleteFailed,
        detail: description,
      };
    }
    return {
      ok: false,
      errorClass: mapBotApiErrorCode(errorCode),
      safeMessage: operation === 'send' ? this.labels.sendFailed : operation === 'edit' ? this.labels.editFailed : this.labels.deleteFailed,
      detail: description !== undefined ? `${errorCode ?? '?'}: ${description}` : String(errorCode ?? 'unknown'),
    };
  }

  /* --------------------------- identity / health --------------------------- */

  async getMe(): Promise<{ ok: boolean; id?: string; username?: string; title?: string; error?: string }> {
    const res = await this.call<TelegramUser>('getMe', {});
    if (!res.ok) return { ok: false, error: res.description };
    return {
      ok: true,
      id: res.result.id !== undefined ? String(res.result.id) : undefined,
      username: res.result.username,
      title: res.result.title ?? res.result.first_name,
    };
  }

  /* ------------------------------ webhooks -------------------------------- */

  async setWebhook(url: string, secret: string): Promise<{ ok: boolean; error?: string }> {
    // `secret_token` is sent on every update as the X-Telegram-Bot-Api-Secret-Token
    // header. Bale accepts the parameter but does not send/verify it (see caveat
    // on FULL_CAPABILITIES.webhookRegistration) — the Bale webhook route must
    // additionally require the X-Postyar-Secret header.
    const res = await this.call<boolean>('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query'] });
    return res.ok ? { ok: true } : { ok: false, error: res.description };
  }

  async deleteWebhook(): Promise<{ ok: boolean; error?: string }> {
    const res = await this.call<boolean>('deleteWebhook', { drop_pending_updates: false });
    return res.ok ? { ok: true } : { ok: false, error: res.description };
  }

  /* ----------------------------- getUpdates ------------------------------- */

  async getUpdates(offset: number): Promise<{ ok: boolean; updates?: UpdateEnvelope[]; error?: string }> {
    const res = await this.call<TelegramUpdate[]>('getUpdates', { offset, limit: 50, timeout: 0 });
    if (!res.ok) return { ok: false, error: res.description };
    const updates: UpdateEnvelope[] = [];
    for (const u of res.result ?? []) {
      const updateId = u.update_id;
      if (updateId === undefined) continue;
      const raw = u as unknown as Record<string, unknown>;
      const cb = u.callback_query;
      const msg = u.message ?? u.edited_message ?? u.channel_post;
      if (cb !== undefined) {
        updates.push({
          externalEventId: String(updateId),
          type: 'callback_query',
          chatId: cb.message?.chat?.id !== undefined ? String(cb.message.chat.id) : undefined,
          senderRef: cb.from?.id !== undefined ? String(cb.from.id) : undefined,
          callbackData: cb.data,
          raw,
        });
      } else if (msg !== undefined) {
        updates.push({
          externalEventId: String(updateId),
          type: u.edited_message !== undefined ? 'edited_message' : u.channel_post !== undefined ? 'channel_post' : 'message',
          chatId: msg.chat?.id !== undefined ? String(msg.chat.id) : undefined,
          senderRef: msg.from?.id !== undefined ? String(msg.from.id) : undefined,
          text: msg.text,
          raw,
        });
      } else {
        updates.push({ externalEventId: String(updateId), type: 'other', raw });
      }
    }
    return { ok: true, updates };
  }

  /* --------------------------- chat verification -------------------------- */

  async verifyChat(chatId: string): Promise<{ ok: boolean; title?: string; username?: string; error?: string }> {
    const res = await this.call<TelegramChat>('getChat', { chat_id: chatId });
    if (!res.ok) return { ok: false, error: res.description };
    return { ok: true, title: res.result.title, username: res.result.username };
  }

  /* ------------------------------- sending -------------------------------- */

  async sendText(chatId: string, text: string, buttons?: ProviderButton[][]): Promise<SendOutcome> {
    return this.sendMessage(chatId, text, buttons);
  }

  async sendMessage(chatId: string, text: string, buttons?: ProviderButton[][]): Promise<SendOutcome> {
    const res = await this.call<{ message_id?: number }>('sendMessage', {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      reply_markup: toProviderButtonRows(buttons),
    });
    if (!res.ok) return this.failure('send', res.errorCode, res.description, res.network);
    return { ok: true, messageId: res.result.message_id !== undefined ? String(res.result.message_id) : '' };
  }

  async sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<SendOutcome> {
    // URL-only photo send (multipart upload NOT needed for v1 — media is
    // referenced by its Postyar permalink; see delivery.worker.ts).
    const res = await this.call<{ message_id?: number }>('sendPhoto', {
      chat_id: chatId,
      photo: photoUrl,
      ...(caption !== undefined ? { caption } : {}),
    });
    if (!res.ok) return this.failure('send', res.errorCode, res.description, res.network);
    return { ok: true, messageId: res.result.message_id !== undefined ? String(res.result.message_id) : '' };
  }

  async editMessageText(chatId: string, messageId: string, text: string): Promise<SendOutcome> {
    const res = await this.call<boolean>('editMessageText', {
      chat_id: chatId,
      message_id: Number(messageId),
      text,
      link_preview_options: { is_disabled: true },
    });
    if (!res.ok) return this.failure('edit', res.errorCode, res.description, res.network);
    return { ok: true, messageId };
  }

  async deleteMessage(chatId: string, messageId: string): Promise<SendOutcome> {
    const res = await this.call<boolean>('deleteMessage', { chat_id: chatId, message_id: Number(messageId) });
    if (!res.ok) return this.failure('delete', res.errorCode, res.description, res.network);
    return { ok: true, messageId };
  }
}
