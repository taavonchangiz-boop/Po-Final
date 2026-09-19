/**
 * Single source of truth for user-facing formatting (§44-46, §168).
 * Persian digits everywhere; Jalali dates everywhere; no ad-hoc formatting
 * in components.
 */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** Convert any Latin digits inside a string/number to Persian digits. */
export function faDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Convert Persian/Arabic digits to Latin (for parsing user input). */
export function toLatinDigits(input: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  return input
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
}

/** Thousand-separated number with Persian digits: ۱۲۳٬۴۵۶ */
export function faNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '۰';
  const n = typeof value === 'number' ? value : Number(toLatinDigits(String(value).replace(/[,٬]/g, '')));
  if (Number.isNaN(n)) return faDigits(value);
  return faDigits(n.toLocaleString('en-US')).replace(/,/g, '٬');
}

/** Money in Toman with Persian digits (amounts stored in Rial). */
export function faMoney(rial: number | null | undefined): string {
  if (rial === null || rial === undefined) return `${faNumber(0)} تومان`;
  const toman = Math.round(rial / 10);
  return `${faNumber(toman)} تومان`;
}

const jalaliDateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: 'long', day: 'numeric',
});
const jalaliShortFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false });

function asDate(input: string | number | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Jalali long date: ۱۵ آبان ۱۴۰۳ (always Persian digits via fa-IR locale). */
export function faDate(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  return d ? jalaliDateFmt.format(d) : '—';
}

/** Jalali short: ۱۴۰۳/۰۸/۱۵ */
export function faDateShort(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  return d ? faDigits(jalaliShortFmt.format(d)) : '—';
}

/** Jalali date + time in Asia/Tehran semantics. */
export function faDateTime(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  if (!d) return '—';
  return `${faDate(d)} ساعت ${faDigits(timeFmt.format(d))}`;
}

/** Relative Persian time: «۳ روز پیش». */
export function faRelative(input: string | number | Date | null | undefined): string {
  const d = asDate(input);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  const future = diff < 0;
  const fmt = (value: number, unit: string) =>
    future ? `${faDigits(value)} ${unit} دیگر` : `${faDigits(value)} ${unit} پیش`;
  if (minutes < 1) return future ? 'همین حالا' : 'همین حالا';
  if (minutes < 60) return fmt(minutes, 'دقیقه');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return fmt(hours, 'ساعت');
  const days = Math.round(hours / 24);
  if (days < 30) return fmt(days, 'روز');
  const months = Math.round(days / 30);
  if (months < 12) return fmt(months, 'ماه');
  return fmt(Math.round(months / 12), 'سال');
}

/** Percentage with Persian digits. */
export function faPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${faDigits((value * 100).toFixed(fractionDigits))}٪`;
}

/** Compact stats: ۱۲۰۰ → ۱٫۲ هزار / ۲٬۳۰۰٬۰۰۰ → ۲٫۳ میلیون */
export function faCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '۰';
  if (Math.abs(value) >= 1_000_000) return `${faDigits((value / 1_000_000).toFixed(1))} میلیون`;
  if (Math.abs(value) >= 1000) return `${faDigits((value / 1000).toFixed(1))} هزار`;
  return faNumber(value);
}

/** Jalali date input helpers: value for <input type="date"> in Gregorian ISO. */
export function isoToJalaliInput(iso: string | Date | null | undefined): string {
  const d = asDate(iso);
  return d ? faDateShort(d) : '';
}

/** Status label maps (§22, §43). */
export const DELIVERY_STATE_FA: Record<string, string> = {
  PENDING: 'در انتظار ارسال',
  PROCESSING: 'در حال پردازش',
  SENT: 'ارسال شد',
  RETRYING: 'در حال تلاش مجدد',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شد',
};

export const POST_STATE_FA: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  SCHEDULED: 'زمان‌بندی‌شده',
  QUEUED: 'در صف انتشار',
  PUBLISHING: 'در حال انتشار',
  PUBLISHED: 'منتشر شد',
  PARTIAL: 'نیمه‌کاره',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شد',
};

export const PLATFORM_FA: Record<string, string> = {
  telegram: 'تلگرام',
  bale: 'بله',
  rubika: 'روبیکا',
};

export const TICKET_STATE_FA: Record<string, string> = {
  OPEN: 'در انتظار پاسخ',
  ANSWERED: 'پاسخ داده شد',
  CLOSED: 'بسته شده',
};
