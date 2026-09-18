/**
 * Referral service: referral summary for the dashboard and the one-time
 * reward granted to the referrer on the referred user's FIRST verified payment.
 * Guarded three ways: referral row must be PENDING (CAS update), the unique
 * index uq_referrals_referred, and the wallet ledger idempotency key
 * `referral-reward:{referredUserId}`.
 */
import { and, count, desc, eq, ne } from 'drizzle-orm';
import { db, type DbExecutor } from '../../db/client.js';
import { payments, referrals, settings, users } from '../../db/schema.js';
import { AnalyticsService } from '../../core/events.js';
import { WalletService } from './wallet.service.js';

export type ReferralRow = typeof referrals.$inferSelect;

const DEFAULT_REWARD_AMOUNT = 500_000; // Rial — mirrors db/seed.ts default

async function readSetting<T>(executor: DbExecutor, key: string): Promise<T | null> {
  const rows = await executor.select().from(settings).where(eq(settings.key, key)).limit(1);
  return (rows[0]?.value as T | undefined) ?? null;
}

export const ReferralService = {
  /** Own code + referred users (masked names) + total rewards. */
  async getSummary(userId: number): Promise<{
    code: string | null;
    referred: Array<{ name: string; status: ReferralRow['status']; rewardAmount: number | null; createdAt: Date }>;
    totalRewarded: number;
  }> {
    const userRows = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1);
    const code = userRows[0]?.referralCode ?? null;

    const rows = await db
      .select({
        referral: referrals,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(referrals)
      .innerJoin(users, eq(referrals.referredUserId, users.id))
      .where(eq(referrals.referrerUserId, userId))
      .orderBy(desc(referrals.id))
      .limit(100);

    const referred = rows.map(({ referral, firstName, lastName }) => ({
      // Privacy: first name + last-name initial only.
      name: `${firstName} ${(lastName?.trim() ? lastName.trim().charAt(0) + '.' : '')}`.trim(),
      status: referral.status,
      rewardAmount: referral.rewardAmount,
      createdAt: referral.createdAt,
    }));

    return {
      code,
      referred,
      totalRewarded: referred.reduce((sum, r) => sum + (r.status === 'REWARDED' ? (r.rewardAmount ?? 0) : 0), 0),
    };
  },

  /**
   * Reward the referrer when this payment is the referred user's FIRST
   * verified payment. Runs inside the payment verification transaction.
   * Never throws for business "not eligible" cases — only for real failures.
   */
  async rewardIfEligible(tx: DbExecutor, referredUserId: number, paymentId: number): Promise<void> {
    const referralRows = await tx
      .select()
      .from(referrals)
      .where(eq(referrals.referredUserId, referredUserId))
      .limit(1);
    const referral = referralRows[0];
    if (!referral || referral.status !== 'PENDING') return;

    const enabled = await readSetting<boolean>(tx, 'referral_enabled');
    if (enabled === false) return;

    // First VERIFIED payment only (current payment already flipped to VERIFIED).
    const verifiedRows = await tx
      .select({ value: count() })
      .from(payments)
      .where(
        and(
          eq(payments.userId, referredUserId),
          eq(payments.status, 'VERIFIED'),
          ne(payments.id, paymentId),
        ),
      );
    if (Number(verifiedRows[0]?.value ?? 0) > 0) return;

    const rawAmount = await readSetting<number>(tx, 'referral_reward_amount');
    const amount = Number.isFinite(rawAmount) && Number(rawAmount) > 0 ? Math.trunc(Number(rawAmount)) : DEFAULT_REWARD_AMOUNT;

    // CAS: only one caller flips PENDING → REWARDED (uq on referredUserId as backstop).
    const updated = await tx
      .update(referrals)
      .set({ status: 'REWARDED', rewardAmount: amount, rewardedAt: new Date() })
      .where(and(eq(referrals.id, referral.id), eq(referrals.status, 'PENDING')));
    if ((updated[0]?.affectedRows ?? 0) === 0) return;

    await WalletService.move(tx, {
      userId: referral.referrerUserId,
      amount,
      direction: 'CREDIT',
      type: 'BONUS',
      referenceType: 'referral',
      referenceId: referral.id,
      idempotencyKey: `referral-reward:${referredUserId}`,
      description: 'پاداش معرفی کاربر جدید',
    });

    AnalyticsService.trackEvent({
      userId: referral.referrerUserId,
      type: 'referral.rewarded',
      subjectType: 'referral',
      subjectId: referral.id,
      data: { referredUserId, amount },
    });
  },
};
