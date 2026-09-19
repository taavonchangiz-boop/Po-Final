/**
 * Provider abstraction (ADR-0005, §16): capability-declaring adapters.
 * Never emulate a capability a platform does not support (§15).
 */
export type Platform = 'telegram' | 'bale' | 'rubika';

export interface ProviderCapabilities {
  sendText: boolean;
  sendMedia: boolean;
  editMessage: boolean;
  deleteMessage: boolean;
  inlineButtons: boolean;
  replyKeyboard: boolean;
  webhook: boolean;
  polling: boolean;
  botIdentity: boolean;
  htmlParseMode: boolean;
}

export interface BotIdentity {
  id: string;
  username: string | null;
  title: string;
}

export interface SendTextInput {
  chatRef: string;
  text: string;
  parseMode?: 'NONE' | 'HTML' | 'MARKDOWN';
  inlineButtons?: Array<{ label: string; url?: string; callback?: string }>;
}

export interface SendMediaInput extends SendTextInput {
  mediaUrl: string;
  kind: 'photo' | 'video';
}

export interface SendResult {
  ok: true;
  messageId: string;
}

export interface ProviderAdapter {
  readonly platform: Platform;
  capabilities(): ProviderCapabilities;
  /** Verify bot token via getMe; throws classified errors. */
  verifyBot(token: string): Promise<BotIdentity>;
  sendText(token: string, input: SendTextInput): Promise<SendResult>;
  sendMedia(token: string, input: SendMediaInput): Promise<SendResult>;
  editMessageCaption?(token: string, chatRef: string, messageId: string, caption: string): Promise<void>;
  deleteMessage?(token: string, chatRef: string, messageId: string): Promise<void>;
  setWebhook?(token: string, url: string, secret?: string): Promise<void>;
  deleteWebhook?(token: string): Promise<void>;
  fetchUpdates?(token: string, offset: number): Promise<unknown[]>;
}

/** Error classification for provider failures (§114, §185). */
export type ProviderErrorClass =
  | 'TRANSIENT' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'NOT_FOUND'
  | 'VALIDATION' | 'BLOCKED' | 'UNKNOWN';

export interface ProviderError extends Error {
  providerClass: ProviderErrorClass;
  userMessageFa: string;
}

export function makeProviderError(providerClass: ProviderErrorClass, userMessageFa: string, cause?: unknown): ProviderError {
  const err = new Error(userMessageFa) as ProviderError;
  err.providerClass = providerClass;
  err.userMessageFa = userMessageFa;
  if (cause) (err as { cause?: unknown }).cause = cause;
  return err;
}

export function mapHttpToProviderError(status: number, description: string): ProviderError {
  const d = description.toLowerCase();
  if (status === 401 || status === 403 || d.includes('unauthorized') || d.includes('forbidden'))
    return makeProviderError('UNAUTHORIZED', 'توکن ربات/کانال نامعتبر یا دسترسی کافی ندارد.');
  if (status === 404 || d.includes('chat not found'))
    return makeProviderError('NOT_FOUND', 'مقصد (کانال/گفتگو) یافت نشد یا ربات عضو آن نیست.');
  if (status === 429 || d.includes('too many requests'))
    return makeProviderError('RATE_LIMITED', 'محدودیت نرخ ارسال پلتفرم؛ بعداً تلاش می‌شود.');
  if (status === 400 && d.includes('parse'))
    return makeProviderError('VALIDATION', 'قالب متن پیام برای این پلتفرم معتبر نیست.');
  if (d.includes('blocked') || d.includes('kicked') || d.includes('not enough rights'))
    return makeProviderError('BLOCKED', 'ارسال به این مقصد مسدود است یا دسترسی ربات کافی نیست.');
  if (status >= 500 || d.includes('timeout') || d.includes('bad gateway'))
    return makeProviderError('TRANSIENT', 'پلتفرم موقتاً در دسترس نیست؛ تلاش مجدد انجام می‌شود.');
  return makeProviderError('UNKNOWN', 'ارسال به پلتفرم ناموفق بود.');
}
