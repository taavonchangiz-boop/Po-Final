/**
 * Durable idempotency for side-effectful operations (payments, wallet moves,
 * delivery enqueue, referral rewards...). First caller wins; concurrent and
 * later callers with the same key receive the stored response.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';
import { conflict } from './errors.js';

export interface IdempotencyResult<T> {
  replayed: boolean;
  value: T;
}

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; errno?: unknown };
  return e.code === 'ER_DUP_ENTRY' || e.errno === 1062;
}

/**
 * Execute `fn` once per (key, scope). The key is claimed via INSERT before fn
 * runs; on duplicate, the stored response is replayed. If the original call is
 * still in flight, a CONFLICT AppError is thrown so clients can retry later.
 */
export async function withIdempotency<T>(
  key: string,
  scope: string,
  fn: () => Promise<T>,
  ttlSeconds = 86_400,
  userId?: number,
): Promise<IdempotencyResult<T>> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  try {
    await db.insert(idempotencyKeys).values({ key, scope, userId: userId ?? null, expiresAt });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;

    const existing = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);
    const row = existing[0];
    if (!row) throw err;

    if (row.expiresAt.getTime() <= Date.now()) {
      // Expired-but-unchanged row: reclaim it and run fresh.
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
      return withIdempotency(key, scope, fn, ttlSeconds, userId);
    }

    if (row.response !== null && row.response !== undefined) {
      return { replayed: true, value: row.response as T };
    }
    throw conflict('درخواست قبلی با همین کلید هنوز در حال پردازش است. لطفاً کمی بعد تلاش کنید.');
  }

  const value = await fn();
  const serialized = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  await db.update(idempotencyKeys).set({ response: serialized }).where(eq(idempotencyKeys.key, key));
  return { replayed: false, value };
}
