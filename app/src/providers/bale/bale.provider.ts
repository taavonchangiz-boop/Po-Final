/**
 * Bale provider (Bot API compatible) — https://tapi.bale.ai/bot{token}.
 *
 * CAVEAT (audit finding F1): Bale's setWebhook accepts the `secret_token`
 * parameter but does NOT send/verify it on inbound webhook calls — provider-side
 * webhook auth is effectively absent. Postyar therefore requires its own
 * `X-Postyar-Secret` header (per-bot random secret) on /webhooks/bale/:botId
 * and recommends polling mode when webhook secrecy cannot be guaranteed.
 */
import { BotApiCompatibleProvider, FULL_CAPABILITIES } from '../botapi.provider.js';
import type { BotProvider, ChannelProvider } from '../types.js';

const BALE_BASE = 'https://tapi.bale.ai/bot';

const LABELS = {
  displayName: 'Bale',
  sendFailed: 'ارسال به بله ناموفق بود.',
  editFailed: 'ویرایش پیام در بله ناموفق بود.',
  deleteFailed: 'حذف پیام در بله ناموفق بود.',
};

export function createBaleProvider(token: string): BotProvider & ChannelProvider {
  return new BotApiCompatibleProvider('BALE', `${BALE_BASE}${token}`, FULL_CAPABILITIES, LABELS);
}
