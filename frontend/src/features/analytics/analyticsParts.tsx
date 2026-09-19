import { toJalaali } from 'jalaali-js';
import { JALALI_MONTHS, toFa } from '../../lib/format';
import type { LabelMap } from '../../lib/format';

/**
 * Analytics feature shared bits (task 4-d-2): Persian label maps for the raw
 * activity timeline (the backend stores technical event types — translation to
 * Persian happens here, per api-contract §Analytics) and Jalali day-label
 * helpers for the daily series.
 */

/* --------------------------- timeline event labels --------------------------- */

/** Raw event.type strings produced by app/src (AnalyticsService.trackEvent). */
export const eventLabels: LabelMap = {
  // auth
  'user.registration': 'ثبت‌نام',
  'user.login': 'ورود به حساب',
  'user.logout': 'خروج از حساب',
  'user.password_reset': 'بازیابی رمز عبور',
  'user.password_changed': 'تغییر رمز عبور',
  // channels
  'channel.created': 'افزودن کانال',
  'channel.connected': 'کانال متصل شد',
  'channel.failed': 'خطای کانال',
  'channel.disconnected': 'قطع اتصال کانال',
  // publishing
  'post.created': 'ایجاد پست',
  'post.publish_now': 'انتشار فوری',
  'post.schedule_fired': 'اجرای زمان‌بندی',
  'post.sent': 'پست ارسال شد',
  'post.failed': 'ارسال پست ناموفق',
  'post.cancelled': 'لغو پست',
  'delivery.retried': 'تلاش مجدد ارسال',
  'link.clicked': 'کلیک روی لینک',
  // bots
  'bot.created': 'اتصال ربات',
  'bot.verified': 'تأیید ربات',
  'bot.deleted': 'حذف ربات',
  'bot.webhook.registration_failed': 'خطای ثبت وب‌هوک ربات',
  'bot.message.received': 'پیام دریافتی ربات',
  'bot.message.sent': 'پیام ارسالی ربات',
  // ai
  'ai.requested': 'درخواست هوش مصنوعی',
  'ai.completed': 'تکمیل پردازش هوش مصنوعی',
  'ai.failed': 'خطای هوش مصنوعی',
  // media
  'media.uploaded': 'بارگذاری رسانه',
  // wordpress
  'wordpress.site.created': 'افزودن سایت وردپرسی',
  'wordpress.site.secret_rotated': 'چرخش کلید سایت',
  'wordpress.site.revoked': 'باطل‌کردن سایت وردپرسی',
  'wordpress.product.published': 'محصول جدید ووکامرس',
  'wordpress.product.updated': 'به‌روزرسانی محصول ووکامرس',
  // gold
  'gold.price.recorded': 'ثبت نرخ طلا',
  'gold.config.upserted': 'به‌روزرسانی تنظیمات انتشار طلا',
  'gold.publish.manual': 'انتشار فوری نرخ طلا',
  'gold.publish.scheduled': 'انتشار زمان‌بندی‌شده نرخ طلا',
  // billing
  'payment.created': 'ایجاد پرداخت',
  'payment.completed': 'پرداخت موفق',
  'payment.failed': 'پرداخت ناموفق',
  'subscription.created': 'فعال‌سازی اشتراک',
  'subscription.renewed': 'تمدید اشتراک',
  'subscription.expiring': 'نزدیک به انقضای اشتراک',
  'subscription.expired': 'انقضای اشتراک',
  'wallet.credit': 'واریز به کیف پول',
  'referral.rewarded': 'پاداش معرفی',
  // notifications / support
  'notification.created': 'اعلان جدید',
  'support.ticket.created': 'ایجاد تیکت',
  'support.ticket.replied': 'پاسخ به تیکت',
};

/** Jalali short label for an ISO day ('2025-01-15' → '۱۰/۲۵'). */
export function faDayLabel(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  const { jm, jd } = toJalaali(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  return toFa(`${jm}/${jd}`);
}

/** Jalali long label for an ISO day ('2025-01-15' → '۲۵ دی ۱۴۰۳') — chart tooltips. */
export function faDayLongLabel(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  const { jy, jm, jd } = toJalaali(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  return `${toFa(jd)} ${JALALI_MONTHS[jm - 1]} ${toFa(jy)}`;
}

/** '2025-01' (UTC month, as returned by GET /ai/usage) → 'دی ۱۴۰۳'. */
export function faMonthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (match === null) return month;
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  const { jy, jm } = toJalaali(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return `${JALALI_MONTHS[jm - 1]} ${toFa(jy)}`;
}
