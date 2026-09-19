import { faMoney } from '../../lib/format';

/**
 * Billing feature shared bits (task 4-d-2): Persian label maps for the REAL
 * backend enums (verified against app/src/modules/billing/* + db/schema.ts) and
 * the payment redirect helper.
 *
 * Notes vs docs/contracts + lib/format:
 *  - payments.status is CREATED | REDIRECTED | VERIFIED | FAILED | REFUNDED
 *    (lib/format paymentStatusLabels has PENDING/CANCELLED/EXPIRED which never
 *    occur on these rows).
 *  - Wallet topup presets / minimum come from PaymentService:
 *    WALLET_TOPUP_PRESETS = [100_000, 500_000, 1_000_000, 2_000_000, 5_000_000],
 *    WALLET_TOPUP_MIN = 100_000 (Rial).
 */

export const paymentStatusLabels: Record<string, string> = {
  CREATED: 'ایجادشده',
  REDIRECTED: 'در انتظار پرداخت',
  VERIFIED: 'پرداخت‌شده',
  FAILED: 'ناموفق',
  REFUNDED: 'بازگشت‌شده',
};

export const paymentStatusTones: Record<string, 'info' | 'success' | 'danger' | 'neutral' | 'warning'> = {
  CREATED: 'info',
  REDIRECTED: 'warning',
  VERIFIED: 'success',
  FAILED: 'danger',
  REFUNDED: 'neutral',
};

export const paymentPurposeLabels: Record<string, string> = {
  SUBSCRIPTION: 'اشتراک',
  WALLET_TOPUP: 'شارژ کیف پول',
};

export const gatewayLabels: Record<string, string> = {
  ZARINPAL: 'زرین‌پال',
  IDPAY: 'آیدی‌پی',
  ZIBAL: 'زیبال',
  MOCK: 'آزمایشی',
};

/** WalletEntry.type enum — CREDIT/DEBIT also appear as generic move types. */
export const walletTypeLabels: Record<string, string> = {
  CREDIT: 'واریز',
  DEBIT: 'برداشت',
  REFUND: 'بازگشت',
  BONUS: 'هدیه',
  PAYMENT: 'پرداخت',
  ADJUSTMENT: 'تعدیل',
};

/** Signed amount by ledger direction. */
export function walletSignedAmount(direction: string | null | undefined, amount: number | null | undefined): string {
  const value = typeof amount === 'number' ? amount : 0;
  return (direction === 'DEBIT' ? '−' : '+') + faMoney(value);
}

/** Persian labels for the plan limits object (subscription + plans pages). */
export const planLimitLabels: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'channels', label: 'کانال' },
  { key: 'postsPerMonth', label: 'پست در ماه' },
  { key: 'aiCredits', label: 'اعتبار هوش مصنوعی' },
  { key: 'bots', label: 'ربات' },
  { key: 'schedules', label: 'زمان‌بندی فعال' },
  { key: 'storageMb', label: 'مگابایت فضای ذخیره‌سازی' },
];

/** Gateway payment — redirect the browser or explain the mock flow honestly. */
export function openGatewayRedirect(redirectUrl: string | null | undefined): void {
  if (redirectUrl && /^https?:\/\//i.test(redirectUrl)) {
    window.location.href = redirectUrl;
  }
}
