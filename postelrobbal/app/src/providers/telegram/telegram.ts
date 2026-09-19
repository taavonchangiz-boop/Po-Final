import { httpJson } from '../../core/http.js';
import {
  ProviderAdapter, ProviderCapabilities, BotIdentity, SendResult,
  SendTextInput, SendMediaInput, makeProviderError, mapHttpToProviderError,
} from '../types.js';

/**
 * Telegram Bot API adapter — api.telegram.org.
 * Full capability set per Bot API: text, media, edit, delete, inline buttons,
 * webhook with secret_token, polling, HTML parse mode.
 */
const BASE = 'https://api.telegram.org';

interface TgResponse<T> { ok: boolean; result?: T; description?: string; error_code?: number }

async function call<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const { data } = await httpJson<TgResponse<T>>(`${BASE}/bot${token}/${method}`, {
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

export class TelegramAdapter implements ProviderAdapter {
  readonly platform = 'telegram' as const;

  capabilities(): ProviderCapabilities {
    return {
      sendText: true, sendMedia: true, editMessage: true, deleteMessage: true,
      inlineButtons: true, replyKeyboard: true, webhook: true, polling: true,
      botIdentity: true, htmlParseMode: true,
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
    const res = await call<{ message_id: number }>(token, 'sendMessage', {
      chat_id: input.chatRef,
      text: input.text,
      ...(input.parseMode === 'HTML' ? { parse_mode: 'HTML' } : {}),
      ...(input.parseMode === 'MARKDOWN' ? { parse_mode: 'MarkdownV2' } : {}),
      ...(this.buttons(input) ? { reply_markup: this.buttons(input) } : {}),
      disable_web_page_preview: false,
    });
    return { ok: true, messageId: String(res.message_id) };
  }

  async sendMedia(token: string, input: SendMediaInput): Promise<SendResult> {
    const method = input.kind === 'photo' ? 'sendPhoto' : 'sendVideo';
    const res = await call<{ message_id: number }>(token, method, {
      chat_id: input.chatRef,
      [input.kind === 'photo' ? 'photo' : 'video']: input.mediaUrl,
      caption: input.text || undefined,
      ...(input.parseMode === 'HTML' ? { parse_mode: 'HTML' } : {}),
      ...(this.buttons(input) ? { reply_markup: this.buttons(input) } : {}),
    });
    return { ok: true, messageId: String(res.message_id) };
  }

  async editMessageCaption(token: string, chatRef: string, messageId: string, caption: string): Promise<void> {
    await call(token, 'editMessageCaption', { chat_id: chatRef, message_id: Number(messageId), caption });
  }

  async deleteMessage(token: string, chatRef: string, messageId: string): Promise<void> {
    await call(token, 'deleteMessage', { chat_id: chatRef, message_id: Number(messageId) });
  }

  async setWebhook(token: string, url: string, secret?: string): Promise<void> {
    await call(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'] });
  }

  async deleteWebhook(token: string): Promise<void> {
    await call(token, 'deleteWebhook', {});
  }

  async fetchUpdates(token: string, offset: number): Promise<unknown[]> {
    return call<unknown[]>(token, 'getUpdates', { offset, limit: 50, timeout: 0 });
  }
}
