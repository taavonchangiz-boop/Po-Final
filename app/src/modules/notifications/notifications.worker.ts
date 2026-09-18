/**
 * Notification worker job: deliver a text to a channel through the
 * ChannelProvider registry (4-b-1 owns providers/*). The worker owns nothing
 * else — outcome is returned to the queue consumer which logs failures.
 *
 * Text is sanitized to 3500 chars (provider message limits).
 */
import { eq } from 'drizzle-orm';
import { decryptSecret } from '../../core/crypto.js';
import { logger } from '../../core/logger.js';
import { db } from '../../db/client.js';
import { channels } from '../../db/schema.js';
import { getChannelProvider } from '../../providers/registry.js';
import type { ProviderKind } from '../../providers/types.js';

const MAX_TEXT = 3500;

export interface ChannelNotificationData {
  channelId: number;
  text: string;
  buttons?: unknown;
}

function asOutcome(value: unknown): { ok: boolean; error?: string } {
  if (value === null || value === undefined) return { ok: true };
  if (typeof value === 'object') {
    const record = value as { ok?: unknown; error?: unknown };
    const ok = record.ok === undefined ? true : Boolean(record.ok);
    const error = typeof record.error === 'string' ? record.error : undefined;
    return { ok, error };
  }
  return { ok: true };
}

/**
 * Send one notification text to one channel. Never throws (queue consumers
 * rely on the returned outcome); failures are logged with class-safe info.
 */
export async function runChannelNotification(data: ChannelNotificationData): Promise<{ ok: boolean; error?: string }> {
  if (!data || typeof data.channelId !== 'number' || typeof data.text !== 'string') {
    return { ok: false, error: 'invalid_notification_payload' };
  }

  const rows = await db.select().from(channels).where(eq(channels.id, data.channelId)).limit(1);
  const channel = rows[0];
  if (!channel) return { ok: false, error: 'channel_not_found' };
  if (channel.status !== 'ACTIVE') return { ok: false, error: 'channel_not_active' };

  let token: string;
  try {
    token = decryptSecret(channel.credentialsEncrypted);
  } catch (err) {
    logger.error('notification_decrypt_failed', { channelId: channel.id, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: 'credential_decrypt_failed' };
  }

  const text = data.text.length > MAX_TEXT ? `${data.text.slice(0, MAX_TEXT - 1)}…` : data.text;

  try {
    const provider = getChannelProvider(channel.provider as ProviderKind, { token });
    const result: unknown = await provider.sendText(channel.chatId, text);
    const outcome = asOutcome(result);
    if (!outcome.ok) {
      logger.warn('notification_send_failed', { channelId: channel.id, error: outcome.error ?? 'unknown' });
      return { ok: false, error: outcome.error ?? 'send_failed' };
    }
    return { ok: true };
  } catch (err) {
    logger.warn('notification_send_error', {
      channelId: channel.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: 'send_error' };
  }
}
