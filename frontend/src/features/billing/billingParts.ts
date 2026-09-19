import { faMoney } from '../../lib/format';
import { get } from '../../lib/api';

/**
 * Billing feature shared bits (task 4-d-2): Persian label maps for the REAL
 * backend enums (verified against app/src/modules/billing/* + db/schema.ts) and
 * the payment redirect helper.
 *
 * Notes vs docs/contracts + lib/format:
 *  - payments.status is CREATED | REDIRECTED | VERIFIED | FAILED | REFUNDED | PENDING
 *    (PENDING = card-to-card awaiting admin approval — task 10-d; lib/format's
 *    PENDING «در انتظار پرداخت» would be misleading so we override here).
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
  PENDING: 'در انتظار تأیید مدیر',
};

export const paymentStatusTones: Record<string, 'info' | 'success' | 'danger' | 'neutral' | 'warning'> = {
  CREATED: 'info',
  REDIRECTED: 'warning',
  VERIFIED: 'success',
  FAILED: 'danger',
  REFUNDED: 'neutral',
  PENDING: 'warning',
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
  CARD: 'کارت به کارت',
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

/**
 * Gateway payment — send the browser to the payment session.
 *
 * Real bank gateways return absolute external URLs → full redirect.
 * The MOCK gateway (dev/integration) returns our own SPA return path
 * (`/app/...`), which must stay on the CURRENT origin — APP_URL host may
 * differ from the SPA origin in dev/sandbox, so absolute navigation to it
 * would dead-end. Such URLs are re-based onto the running origin.
 *
 * Returns where the browser was sent so callers can toast honestly:
 *  - 'external': bank/gateway URL (full page redirect)
 *  - 'internal': own SPA return path (same-origin navigation)
 *  - 'none': nothing usable — caller must show an error
 */
export function openGatewayRedirect(redirectUrl: string | null | undefined): 'external' | 'internal' | 'none' {
  if (!redirectUrl || redirectUrl.length === 0) return 'none';
  if (/^https?:\/\//i.test(redirectUrl)) {
    try {
      const url = new URL(redirectUrl);
      if (url.pathname.startsWith('/app/')) {
        window.location.href = url.pathname + url.search;
        return 'internal';
      }
    } catch {
      // malformed absolute URL — fall through to a raw redirect attempt
    }
    window.location.href = redirectUrl;
    return 'external';
  }
  if (redirectUrl.startsWith('/')) {
    window.location.href = redirectUrl;
    return 'internal';
  }
  return 'none';
}

/**
 * MOCK/dev payment return flow: the MOCK gateway lands the browser on
 * `/app/...?mock_payment=<id>&authority=...` with the payment still REDIRECTED.
 * Completing the loop = hitting the (public, idempotent) gateway callback —
 * the same thing a real gateway's browser return triggers — which verifies the
 * payment server-side, applies subscription/wallet effects exactly once and
 * returns the SPA redirect path (`?payment=ok|failed`) for the final toast.
 */
export async function settleMockPayment(paymentId: string, authority?: string | null): Promise<string> {
  const params = new URLSearchParams({ payment_id: paymentId });
  if (authority) params.set('authority', authority);
  const data = await get<{ redirect?: string }>(`/payments/callback/mock?${params.toString()}`);
  return data?.redirect ?? '/app/subscription?payment=ok';
}
