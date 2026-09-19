/**
 * Wallet service (ADR-013): authoritative balance row + append-only ledger.
 * Balance changes happen ONLY inside a transaction with SELECT ... FOR UPDATE;
 * every ledger row carries balance_after and a unique idempotency key.
 */
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '../../db/client.js';
import { walletEntries, wallets } from '../../db/schema.js';
import { paymentError } from '../../core/errors.js';
import { AnalyticsService } from '../../core/events.js';

export type WalletRow = typeof wallets.$inferSelect;
export type WalletEntryRow = typeof walletEntries.$inferSelect;

export type WalletEntryType = 'CREDIT' | 'DEBIT' | 'REFUND' | 'BONUS' | 'PAYMENT' | 'ADJUSTMENT';

export interface WalletMoveInput {
  userId: number;
  amount: number; // positive integer Rial
  direction: 'CREDIT' | 'DEBIT';
  type: WalletEntryType;
  referenceType?: string;
  referenceId?: number;
  idempotencyKey: string;
  description?: string;
}

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; errno?: unknown };
  return e.code === 'ER_DUP_ENTRY' || e.errno === 1062;
}

/** Load the wallet row, creating it lazily (executor may be a transaction). */
async function getOrCreateWallet(executor: DbExecutor, userId: number): Promise<WalletRow> {
  const rows = await executor.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  const existing = rows[0];
  if (existing) return existing;
  await executor.insert(wallets).values({ userId, balance: 0 }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
  const created = await executor.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  const row = created[0];
  if (!row) throw new Error('wallet_create_failed');
  return row;
}

async function lockedBalance(executor: DbExecutor, userId: number): Promise<number> {
  const rows = await executor
    .select({ balance: wallets.balance, id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .for('update');
  const row = rows[0];
  if (row) return row.balance;
  // No wallet yet — create outside the locked read, then re-read with the lock.
  await getOrCreateWallet(executor, userId);
  const again = await executor.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, userId)).for('update');
  return again[0]?.balance ?? 0;
}

export const WalletService = {
  /** Wallet with the 10 most recent ledger entries. */
  async getWalletSummary(userId: number): Promise<{ wallet: WalletRow; entries: WalletEntryRow[] }> {
    const wallet = await getOrCreateWallet(db, userId);
    const entries = await db
      .select()
      .from(walletEntries)
      .where(eq(walletEntries.userId, userId))
      .orderBy(desc(walletEntries.id))
      .limit(10);
    return { wallet, entries };
  },

  async listEntries(userId: number, page: number, limit: number): Promise<{ items: WalletEntryRow[]; total: number }> {
    const [items, totalRows] = await Promise.all([
      db
        .select()
        .from(walletEntries)
        .where(eq(walletEntries.userId, userId))
        .orderBy(desc(walletEntries.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(walletEntries).where(eq(walletEntries.userId, userId)),
    ]);
    return { items, total: Number(totalRows[0]?.value ?? 0) };
  },

  /**
   * Credit (or debit) the wallet inside the CALLER's transaction.
   * Idempotent per idempotencyKey: an existing ledger row short-circuits the
   * move (skipped). The balance update happens ONLY together with the ledger
   * insert — if a concurrent duplicate insert loses the race we THROW so the
   * caller's transaction rolls back fully (never a double-applied balance);
   * any retry then hits the ledger short-circuit above.
   */
  async move(tx: DbExecutor, input: WalletMoveInput): Promise<{ balance: number; skipped: boolean }> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw paymentError('مبلغ نامعتبر است.');
    }

    // 1) Replay check BEFORE mutating anything.
    const existingRows = await tx
      .select({ balanceAfter: walletEntries.balanceAfter })
      .from(walletEntries)
      .where(eq(walletEntries.idempotencyKey, input.idempotencyKey.slice(0, 120)))
      .limit(1);
    const existing = existingRows[0];
    if (existing) return { balance: existing.balanceAfter, skipped: true };

    // 2) Lock, compute, apply.
    const current = await lockedBalance(tx, input.userId);
    const next = input.direction === 'CREDIT' ? current + input.amount : current - input.amount;
    if (next < 0) throw paymentError('موجودی کیف پول کافی نیست.');

    await tx
      .update(wallets)
      .set({ balance: next, updatedAt: new Date() })
      .where(eq(wallets.userId, input.userId));

    await tx.insert(walletEntries).values({
      userId: input.userId,
      direction: input.direction,
      type: input.type,
      amount: input.amount,
      balanceAfter: next,
      referenceType: input.referenceType?.slice(0, 40),
      referenceId: input.referenceId ?? null,
      description: input.description?.slice(0, 255),
      idempotencyKey: input.idempotencyKey.slice(0, 120),
    });

    return { balance: next, skipped: false };
  },

  /** Wallet credit for a verified payment/top-up (idempotent per payment). */
  async credit(
    tx: DbExecutor,
    userId: number,
    amount: number,
    opts: { referenceId: number; idempotencyKey: string; description: string },
  ): Promise<{ balance: number; skipped: boolean }> {
    const result = await WalletService.move(tx, {
      userId,
      amount,
      direction: 'CREDIT',
      type: 'PAYMENT',
      referenceType: 'payment',
      referenceId: opts.referenceId,
      idempotencyKey: opts.idempotencyKey,
      description: opts.description,
    });
    if (!result.skipped) {
      AnalyticsService.trackEvent({
        userId,
        type: 'wallet.credit',
        subjectType: 'wallet',
        data: { amount, referenceId: opts.referenceId },
      });
    }
    return result;
  },

  /** Sum of positive entries (admin dashboards). */
  async totalCredited(): Promise<number> {
    const rows = await db
      .select({ total: sql<string>`coalesce(sum(${walletEntries.amount}), 0)` })
      .from(walletEntries)
      .where(and(eq(walletEntries.direction, 'CREDIT')));
    return Number(rows[0]?.total ?? 0);
  },
};
