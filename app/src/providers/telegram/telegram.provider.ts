/**
 * Telegram provider (Bot API compatible) — https://api.telegram.org/bot{token}.
 * Webhooks authenticate via the X-Telegram-Bot-Api-Secret-Token header set at
 * registration time (secret_token param) — verified with hash_equals.
 */
import { BotApiCompatibleProvider, FULL_CAPABILITIES } from '../botapi.provider.js';
import type { BotProvider, ChannelProvider } from '../types.js';

const TELEGRAM_BASE = 'https://api.telegram.org/bot';

const LABELS = {
  displayName: 'Telegram',
  sendFailed: 'ارسال به تلگرام ناموفق بود.',
  editFailed: 'ویرایش پیام در تلگرام ناموفق بود.',
  deleteFailed: 'حذف پیام در تلگرام ناموفق بود.',
};

export function createTelegramProvider(token: string): BotProvider & ChannelProvider {
  return new BotApiCompatibleProvider('TELEGRAM', `${TELEGRAM_BASE}${token}`, FULL_CAPABILITIES, LABELS);
}
