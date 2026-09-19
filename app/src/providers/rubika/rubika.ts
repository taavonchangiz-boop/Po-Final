import { httpJson } from '../../core/http.js';
import {
  ProviderAdapter, ProviderCapabilities, BotIdentity, SendResult,
  SendTextInput, SendMediaInput, makeProviderError, mapHttpToProviderError,
} from '../types.js';

/**
 * Rubika adapter — first-class provider (§15).
 * Rubika exposes a Bot API at botapi.rubika.ir (getMe, sendMessage, sendPhoto,
 * editMessageText, setWebhook...). Capability map is deliberately conservative:
 * deleteMessage and reply-keyboards are declared unsupported until the platform
 * documents them. No capability is emulated (§16).
 */
const BASE = 'https://botapi.rubika.ir';

interface RubikaResponse<T> { ok: boolean; result?: T; status?: string; message?: string; error_code?: number }

async function call<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const { data } = await httpJson<RubikaResponse<T>>(`${BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: 20_000,
  }).catch((err) => {
    throw makeProviderError('TRANSIENT', 'پلتفرم موقتاً در دسترس نیست؛ تلاش مجدد انجام می‌شود.', err);
  });
  if ((data.ok === false) || data.status?.toUpperCase() === 'ERROR' || data.result === undefined) {
    throw mapHttpToProviderError(data.error_code ?? 500, data.message ?? data.status ?? 'unknown error');
  }
  return data.result;
}

export class RubikaAdapter implements ProviderAdapter {
  readonly platform = 'rubika' as const;

  capabilities(): ProviderCapabilities {
    return {
      sendText: true, sendMedia: true, editMessage: true, deleteMessage: false,
      inlineButtons: false, replyKeyboard: false, webhook: true, polling: true,
      botIdentity: true, htmlParseMode: false,
    };
  }

  async verifyBot(token: string): Promise<BotIdentity> {
    const me = await call<{ bot_id: string; username?: string; title?: string; first_name?: string }>(token, 'getMe', {});
    return {
      id: String(me.bot_id ?? me.username ?? ''),
      username: me.username ?? null,
      title: me.title ?? me.first_name ?? 'ربات روبیکا',
    };
  }

  async sendText(token: string, input: SendTextInput): Promise<SendResult> {
    if (input.inlineButtons?.length) {
      throw makeProviderError('VALIDATION', 'روبیکا از دکمهٔ شیشه‌ای پشتیبانی نمی‌کند.');
    }
    const res = await call<{ message_id: string }>(token, 'sendMessage', {
      chat_id: input.chatRef,
      text: input.text,
    });
    return { ok: true, messageId: String(res.message_id ?? '') };
  }

  async sendMedia(token: string, input: SendMediaInput): Promise<SendResult> {
    const res = await call<{ message_id: string }>(token, input.kind === 'photo' ? 'sendPhoto' : 'sendVideo', {
      chat_id: input.chatRef,
      [input.kind === 'photo' ? 'photo' : 'video']: input.mediaUrl,
      caption: input.text || undefined,
    });
    return { ok: true, messageId: String(res.message_id ?? '') };
  }

  async editMessageCaption(token: string, chatRef: string, messageId: string, caption: string): Promise<void> {
    await call(token, 'editMessageText', { chat_id: chatRef, message_id: messageId, text: caption });
  }

  async setWebhook(token: string, url: string): Promise<void> {
    await call(token, 'setWebhook', { url });
  }

  async deleteWebhook(token: string): Promise<void> {
    await call(token, 'deleteWebhook', {});
  }

  async fetchUpdates(token: string, offset: number): Promise<unknown[]> {
    const res = await call<{ updates: unknown[] }>(token, 'getUpdates', { offset, limit: 50 });
    return res.updates ?? [];
  }
}
