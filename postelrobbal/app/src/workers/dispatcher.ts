import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { postTargets } from '../db/schema.js';
import { Dispatcher } from '../core/outbox.js';
import { enqueue } from '../queue/queues.js';

/**
 * Outbox relay dispatcher (§125). Maps durable outbox rows onto BullMQ jobs:
 *   - post.publish       → one 'deliver' job per PENDING post_target
 *   - wordpress.publish  → single 'deliver-product' job (payload forwarded;
 *                          created by the wordpress module, payloadJson =
 *                          {tenantId, siteId, productId, channelId, ...})
 * Unknown event types throw so the relay marks the row FAILED (poison guard).
 */
export const outboxDispatcher: Dispatcher = {
  async dispatch(event: { id: string; eventType: string; payloadJson: Record<string, unknown>; aggregateId: string }): Promise<void> {
    if (event.eventType === 'post.publish') {
      const db = getDb();
      const targets = await db
        .select({ id: postTargets.id })
        .from(postTargets)
        .where(and(eq(postTargets.postId, event.aggregateId), eq(postTargets.state, 'PENDING')))
        .limit(500);
      for (const target of targets) {
        // jobId keys on the outbox row: relay retries cannot double-enqueue the
        // same target, while re-publishes (new outbox row) enqueue cleanly.
        await enqueue('delivery', 'deliver', { targetId: target.id }, { jobId: `deliver:${event.id}:${target.id}` });
      }
      return;
    }

    if (event.eventType === 'wordpress.publish') {
      await enqueue('delivery', 'deliver-product', { payloadJson: event.payloadJson });
      return;
    }

    throw new Error(`UNKNOWN_OUTBOX_EVENT_TYPE: ${event.eventType}`);
  },
};
