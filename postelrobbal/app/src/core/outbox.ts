import { and, eq, lte, or, isNull, asc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { outboxEvents } from '../db/schema.js';
import { newId } from './ids.js';

/**
 * Transactional outbox (§125). Business operations persist the outbox row
 * inside the SAME transaction as the business state. The relay then
 * dispatches to BullMQ. This module provides the row shape + relay.
 */
export interface OutboxInput {
  aggregateType: 'post' | 'notification' | 'wordpress' | 'gold' | 'ai';
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export function outboxRow(input: OutboxInput) {
  return {
    id: newId(),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payloadJson: input.payload,
    state: 'PENDING' as const,
    attempts: 0,
  };
}

export interface Dispatcher {
  dispatch(event: { id: string; eventType: string; payloadJson: Record<string, unknown>; aggregateId: string }): Promise<void>;
}

/** Relay pending outbox events to the queue. Called by worker loop. */
export async function relayOutbox(dispatcher: Dispatcher, batchSize = 50): Promise<number> {
  const db = getDb();
  const pending = await db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.state, 'PENDING'))
    .orderBy(asc(outboxEvents.createdAt))
    .limit(batchSize);

  let dispatched = 0;
  for (const ev of pending) {
    try {
      await dispatcher.dispatch({
        id: ev.id,
        eventType: ev.eventType,
        payloadJson: ev.payloadJson ?? {},
        aggregateId: ev.aggregateId,
      });
      await db
        .update(outboxEvents)
        .set({ state: 'DISPATCHED', dispatchedAt: new Date() })
        .where(eq(outboxEvents.id, ev.id));
      dispatched++;
    } catch {
      await db
        .update(outboxEvents)
        .set({ attempts: ev.attempts + 1, state: ev.attempts >= 10 ? 'FAILED' : 'PENDING' })
        .where(eq(outboxEvents.id, ev.id));
    }
  }
  return dispatched;
}
