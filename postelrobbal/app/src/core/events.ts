import { getDb } from '../db/client.js';
import { events, eventDaily } from '../db/schema.js';
import { newId } from './ids.js';
import { sql } from 'drizzle-orm';

/**
 * Analytics event emission (§24, §165). No credentials/tokens/secrets in props.
 * Aggregates into event_daily (read model §99) inside the same call — cheap
 * single upsert, bounded by event whitelist.
 */
export const ALLOWED_EVENTS = new Set<string>([
  'user.registration', 'user.login', 'user.logout',
  'channel.created', 'channel.connected', 'channel.disconnected', 'channel.updated',
  'post.created', 'post.scheduled', 'post.sent', 'post.failed',
  'bot.created', 'bot.enabled', 'bot.disabled', 'bot.message.received', 'bot.message.sent', 'bot.button.clicked',
  'workflow.started', 'workflow.completed', 'workflow.failed',
  'ai.requested', 'ai.completed', 'ai.failed',
  'wordpress.connected', 'wordpress.product.synced', 'wordpress.product.published',
  'subscription.created', 'subscription.renewed', 'subscription.expiring', 'subscription.expired',
  'payment.created', 'payment.completed', 'payment.failed',
  'wallet.credit', 'wallet.debit', 'referral.created', 'referral.rewarded',
]);

export function sanitizeProps(props: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!props) return null;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (/secret|token|password|key|credential/i.test(k)) continue; // never store credential-like keys
    if (typeof v === 'string' && v.length > 500) continue;
    if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string')) clean[k] = v;
  }
  return clean;
}

export async function emitEvent(input: {
  name: string;
  tenantId?: string | null;
  subjectType?: string;
  subjectId?: string;
  props?: Record<string, unknown>;
}): Promise<void> {
  if (!ALLOWED_EVENTS.has(input.name)) return;
  const db = getDb();
  const tenantId = input.tenantId ?? null;
  await db.insert(events).values({
    id: newId(),
    tenantId,
    name: input.name,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    propsJson: sanitizeProps(input.props),
  });
  if (tenantId) {
    const day = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    await db
      .insert(eventDaily)
      .values({ tenantId, day, eventName: input.name, eventCount: 1 })
      .onDuplicateKeyUpdate({ set: { eventCount: sql`${eventDaily.eventCount} + 1` } });
  }
}
