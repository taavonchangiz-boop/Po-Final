import { httpJson } from '../../core/http.js';
import {
  ProviderAdapter, ProviderCapabilities, BotIdentity, SendResult,
  SendTextInput, SendMediaInput, makeProviderError, mapHttpToProviderError,
} from '../types.js';

/**
 * Bale adapter — tapi.bale.ai implements the Telegram Bot API protocol
 * (AUDIT: woo plugin used identical payload shapes). Declared deltas:
 * deleteMessage unsupported; HTML parse mode unreliable → plain text default
 * (reference bug 9.2: "strip HTML for Bale" — we encode that as a capability).
 */
const BASE = 'https://tapi.bale.ai';

interface BaleResponse<T> { ok: boolean; result?: T; description?: string; error_code?: number }

async function call<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const { data } = await httpJson<BaleResponse<T>>(`${BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: 20_000,
  }).catch((err) => {
    throw makeProviderError('TRANSIENT', 'پلتفرم موقتاً در دسترس نیست؛ تلاش مجدد انجام می‌شود.', err);
  });
  if (!data.ok || data.result === undefined) {
    throw mapHttpToProviderError(data.error_code ?? 500, data.description ?? 'unknown error');
  }
  return data.result;
}

export class BaleAdapter implements ProviderAdapter {
  readonly platform = 'bale' as const;

  capabilities(): ProviderCapabilities {
    return {
      sendText: true, sendMedia: true, editMessage: true, deleteMessage: false,
      inlineButtons: true, replyKeyboard: true, webhook: true, polling: true,
      botIdentity: true, htmlParseMode: false,
    };
  }

  async verifyBot(token: string): Promise<BotIdentity> {
    const me = await call<{ id: number; username?: string; first_name: string }>(token, 'getMe', {});
    return { id: String(me.id), username: me.username ?? null, title: me.first_name };
  }

  private buttons(input: { inlineButtons?: Array<{ label: string; url?: string; callback?: string }> }) {
    if (!input.inlineButtons?.length) return undefined;
    return { inline_keyboard: input.inlineButtons.map((b) => (b.url ? { text: b.label, url: b.url } : { text: b.label, callback_data: b.callback ?? b.label })) };
  }

  async sendText(token: string, input: SendTextInput): Promise<SendResult> {
    // Bale: plain text only (no parse_mode) — capability-declared, not emulated.
    const res = await call<{ message_id: number }>(token, 'sendMessage', {
      chat_id: input.chatRef,
      text: input.text,
      ...(this.buttons(input) ? { reply_markup: this.buttons(input) } : {}),
    });
    return { ok: true, messageId: String(res.message_id) };
  }

  async sendMedia(token: string, input: SendMediaInput): Promise<SendResult> {
    const method = input.kind === 'photo' ? 'sendPhoto' : 'sendVideo';
    const res = await call<{ message_id: number }>(token, method, {
      chat_id: input.chatRef,
      [input.kind === 'photo' ? 'photo' : 'video']: input.mediaUrl,
      caption: input.text || undefined,
      ...(this.buttons(input) ? { reply_markup: this.buttons(input) } : {}),
    });
    return { ok: true, messageId: String(res.message_id) };
  }

  async editMessageCaption(token: string, chatRef: string, messageId: string, caption: string): Promise<void> {
    await call(token, 'editMessageCaption', { chat_id: chatRef, message_id: Number(messageId), caption });
  }

  async setWebhook(token: string, url: string, secret?: string): Promise<void> {
    // Bale supports webhook without secret_token header; the URL path carries
    // an unguessable per-bot id and we additionally validate the update shape.
    await call(token, 'setWebhook', { url, allowed_updates: ['message', 'callback_query'] });
    void secret;
  }

  async deleteWebhook(token: string): Promise<void> {
    await call(token, 'deleteWebhook', {});
  }

  async fetchUpdates(token: string, offset: number): Promise<unknown[]> {
    return call<unknown[]>(token, 'getUpdates', { offset, limit: 50, timeout: 0 });
  }
}
