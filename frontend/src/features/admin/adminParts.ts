import { faMoney, toFa } from '../../lib/format';

/**
 * Admin feature shared bits (task 4-d-2): Persian label maps for the REAL
 * backend enums (verified against app/src/modules/admin/* + db/schema.ts) and
 * audit-action translation with an honest fallback to the raw action key.
 *
 * Notes:
 *  - audit_logs rows carry actorUserId only (no actor name) — the UI shows
 *    «کاربر #id»; there is no password display anywhere (passwordHash is never
 *    selected by the admin service).
 *  - Ticket thread reading for staff is available via GET /admin/tickets/:id
 *    (with attachment metadata — task 10-d); status changes + replies are
 *    audited.
 */

export const userStatusLabels: Record<string, string> = {
  ACTIVE: 'فعال',
  SUSPENDED: 'معلق',
};

/** payments.method (task 10-d): ONLINE = gateway session, CARD = card-to-card. */
export const paymentMethodLabels: Record<string, string> = {
  ONLINE: 'درگاه آنلاین',
  CARD: 'کارت به کارت',
};

export const userStatusTones: Record<string, 'success' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  SUSPENDED: 'danger',
};

/** support_tickets.status: OPEN | ANSWERED | PENDING_USER | CLOSED. */
export const adminTicketStatusLabels: Record<string, string> = {
  OPEN: 'باز',
  ANSWERED: 'پاسخ داده شد',
  PENDING_USER: 'در انتظار پاسخ کاربر',
  CLOSED: 'بسته',
};

export const adminTicketStatusTones: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  OPEN: 'info',
  ANSWERED: 'success',
  PENDING_USER: 'warning',
  CLOSED: 'neutral',
};

/** Every audit action emitted by the backend (trackEvent + trackAudit). */
export const auditActionLabels: Record<string, string> = {
  // admin
  'admin.user.updated': 'ویرایش کاربر',
  'admin.plan.updated': 'ویرایش پلن',
  'admin.settings.updated': 'ویرایش تنظیمات',
  'admin.payment_settings.updated': 'ویرایش تنظیمات پرداخت',
  'admin.payment.approved': 'تأیید پرداخت کارت به کارت',
  'admin.payment.rejected': 'رد پرداخت کارت به کارت',
  'admin.ticket.replied': 'پاسخ به تیکت',
  // auth
  'user.registration': 'ثبت‌نام',
  'user.login': 'ورود',
  'user.logout': 'خروج',
  'user.password_reset': 'بازیابی رمز',
  'user.password_changed': 'تغییر رمز',
  // channels
  'channel.created': 'افزودن کانال',
  'channel.connected': 'اتصال کانال',
  'channel.updated': 'ویرایش کانال',
  'channel.token_rotated': 'چرخش توکن کانال',
  'channel.disabled': 'غیرفعال‌سازی کانال',
  'channel.disconnected': 'قطع اتصال کانال',
  // wordpress
  'wordpress.site.created': 'افزودن سایت وردپرسی',
  'wordpress.site.secret_rotated': 'چرخش کلید سایت',
  'wordpress.site.revoked': 'باطل‌کردن سایت',
  // billing
  'payment.created': 'ایجاد پرداخت',
  'payment.card_submitted': 'ثبت رسید کارت به کارت',
  'payment.completed': 'تأیید پرداخت',
  'payment.failed': 'شکست پرداخت',
  'subscription.created': 'فعال‌سازی اشتراک',
  'subscription.renewed': 'تمدید اشتراک',
  'wallet.credit': 'واریز کیف پول',
  'referral.rewarded': 'پاداش معرفی',
  // gold / ai / support
  'gold.price.recorded': 'ثبت نرخ طلا',
  'gold.config.upserted': 'ویرایش تنظیمات طلا',
  'gold.publish.manual': 'انتشار دستی طلا',
  'ai.requested': 'درخواست هوش مصنوعی',
  'ai.completed': 'تکمیل پردازش هوش مصنوعی',
  'ai.failed': 'خطای هوش مصنوعی',
  'support.ticket.created': 'ایجاد تیکت',
  'support.ticket.replied': 'پاسخ به تیکت',
};

/** Actions offered in the audit filter select (common admin-relevant ones). */
export const AUDIT_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'همهٔ اقدامات' },
  { value: 'admin.user.updated', label: 'ویرایش کاربر' },
  { value: 'admin.plan.updated', label: 'ویرایش پلن' },
  { value: 'admin.settings.updated', label: 'ویرایش تنظیمات' },
  { value: 'admin.ticket.replied', label: 'پاسخ به تیکت' },
  { value: 'user.login', label: 'ورود' },
  { value: 'user.registration', label: 'ثبت‌نام' },
  { value: 'payment.completed', label: 'تأیید پرداخت' },
  { value: 'channel.token_rotated', label: 'چرخش توکن کانال' },
  { value: 'wordpress.site.created', label: 'افزودن سایت وردپرسی' },
];

export function actorLabel(actorUserId: number | null | undefined): string {
  if (actorUserId === null || actorUserId === undefined) return 'سیستم';
  return `کاربر #${toFa(actorUserId)}`;
}

export function subjectLabel(subjectType: string | null | undefined, subjectId: number | null | undefined): string {
  if (!subjectType) return '—';
  const typeLabels: Record<string, string> = {
    user: 'کاربر',
    plan: 'پلن',
    settings: 'تنظیمات',
    ticket: 'تیکت',
    channel: 'کانال',
    payment: 'پرداخت',
    subscription: 'اشتراک',
    wordpress_site: 'سایت وردپرسی',
    gold_config: 'تنظیمات طلا',
    ai_job: 'درخواست هوش مصنوعی',
    post: 'پست',
    bot: 'ربات',
  };
  const label = typeLabels[subjectType] ?? subjectType;
  return subjectId !== null && subjectId !== undefined ? `${label} #${toFa(subjectId)}` : label;
}

/** Persian plan price for admin tables. */
export function planPrice(priceMonthly: number | null | undefined): string {
  return typeof priceMonthly === 'number' ? faMoney(priceMonthly) : '—';
}
