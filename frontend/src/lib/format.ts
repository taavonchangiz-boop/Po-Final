/**
 * Postyar formatting kernel — the SINGLE shared source for all user-visible formatting.
 *
 * BINDING (PRODUCT-SPEC §5):
 *  - Persian digits everywhere user-visible
 *  - Jalali calendar everywhere user-visible (API/storage is UTC ISO)
 *  - Money is BIGINT Rial, displayed with '٬' grouping + ' ریال'
 *  - Decimal separator '٫', thousands separator '٬'
 *  - Persian labels for every enum (technical enums stay internal)
 *
 * Pure functions only — no DOM, no side effects. Keep label maps in sync with
 * docs/contracts/api-contract.md stable codes.
 */
import { toJalaali as jalaaliToJalaali, toGregorian as jalaaliToGregorian } from 'jalaali-js';

/* ------------------------------------------------------------------ */
/* Digits                                                              */
/* ------------------------------------------------------------------ */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** Convert any Latin digits in the input to Persian digits (۰–۹). */
export function toFa(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Convert Persian/Arabic digits to Latin digits (for parsing user input). */
export function toEn(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

const FA_GROUP = '٬';
const FA_DECIMAL = '٫';

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Format a number in Persian digits; optional '٬' thousands grouping. */
export function faNumber(n: number, opts: { group?: boolean } = {}): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const [intRaw, decRaw] = (abs < 1e21 ? String(abs) : abs.toExponential()).split('.');
  const intPart = opts.group ? intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, FA_GROUP) : intRaw;
  const decPart = decRaw !== undefined ? FA_DECIMAL + decRaw : '';
  return (n < 0 ? '−' : '') + toFa(intPart + decPart);
}

/** Money: grouped Persian number + ' ریال' (input is Rial). */
export function faMoney(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return faNumber(n, { group: true }) + ' ریال';
}

/** Percentage: input is a 0–100 value; one decimal max, '٪' suffix. */
export function faPercent(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return faNumber(round1(x)) + '٪';
}

/** Compact Persian magnitude: 'هزار' / 'میلیون' / 'میلیارد'. */
export function faCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs < 1000) return sign + faNumber(abs);
  if (abs < 1e6) return sign + faNumber(round1(abs / 1e3)) + ' هزار';
  if (abs < 1e9) return sign + faNumber(round1(abs / 1e6)) + ' میلیون';
  return sign + faNumber(round1(abs / 1e9)) + ' میلیارد';
}

/* ------------------------------------------------------------------ */
/* Jalali calendar (via jalaali-js, the one unified kernel)            */
/* ------------------------------------------------------------------ */

export interface Jalaali {
  jy: number;
  jm: number;
  jd: number;
}

/** Gregorian Date → Jalali {jy, jm, jd} (local calendar components). */
export function toJalali(date: Date): Jalaali {
  return jalaaliToJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDate(input: Date | string | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** '۱۴۰۳/۱۰/۱۵' — Gregorian (ISO or Date) → zero-padded Jalali, Persian digits. */
export function faDate(input: Date | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return '';
  const { jy, jm, jd } = toJalali(d);
  return toFa(`${jy}/${pad2(jm)}/${pad2(jd)}`);
}

/** '۱۴۰۳/۱۰/۱۵، ۱۴:۳۰' — date + time (local). */
export function faDateTime(input: Date | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return '';
  const date = faDate(d);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${date}، ${toFa(time)}`;
}

/** '۱۵ دی ۱۴۰۳' — long Jalali date with month name. */
export function faDateLong(input: Date | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return '';
  const { jy, jm, jd } = toJalali(d);
  return toFa(jd) + ' ' + JALALI_MONTHS[jm - 1] + ' ' + toFa(jy);
}

/**
 * Jalali (y/m/d + optional hh:mm) → local Date. Used by schedule pickers;
 * call `.toISOString()` on the result to send UTC ISO to the API.
 */
export function jalaliToGregorianISO(jy: number, jm: number, jd: number, hh = 0, mm = 0): Date {
  const g = jalaaliToGregorian(jy, jm, jd);
  return new Date(g.gy, g.gm - 1, g.gd, hh, mm, 0, 0);
}

/** '۲ ساعت پیش' / 'در ۳ روز' style relative time. */
export function relativeTimeFa(input: Date | string | null | undefined): string {
  const d = toDate(input);
  if (!d) return '';
  const diffMs = d.getTime() - Date.now();
  const absSec = Math.abs(Math.round(diffMs / 1000));
  const future = diffMs > 0;
  if (absSec < 45) return future ? 'لحظاتی دیگر' : 'چند لحظه پیش';
  const pick = (n: number, unit: string) =>
    future ? `${toFa(n)} ${unit} دیگر` : `${toFa(n)} ${unit} پیش`;
  const minutes = Math.round(absSec / 60);
  if (minutes < 60) return pick(minutes, 'دقیقه');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return pick(hours, 'ساعت');
  const days = Math.round(hours / 24);
  if (days <= 31) return pick(days, 'روز');
  const months = Math.round(days / 30);
  if (months < 12) return pick(months, 'ماه');
  return pick(Math.round(months / 12), 'سال');
}

/* ------------------------------------------------------------------ */
/* Persian label maps (single source — Badge/components read these)    */
/* ------------------------------------------------------------------ */

export type LabelMap = Readonly<Record<string, string>>;

/** Delivery states. */
export const stateLabels: LabelMap = {
  PENDING: 'در انتظار',
  PROCESSING: 'در حال ارسال',
  SENT: 'ارسال شد',
  RETRYING: 'تلاش مجدد',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شد',
};

/** Post lifecycle. */
export const postStatusLabels: LabelMap = {
  DRAFT: 'پیش‌نویس',
  SCHEDULED: 'زمان‌بندی‌شده',
  PUBLISHING: 'در حال انتشار',
  PUBLISHED: 'منتشر شد',
  PARTIAL: 'ناقص',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شد',
};

/** Providers. */
export const providerLabels: LabelMap = {
  TELEGRAM: 'تلگرام',
  BALE: 'بله',
  RUBIKA: 'روبیکا',
};

/** Plan keys (API plan names override when present). */
export const planLabels: LabelMap = {
  FREE: 'رایگان',
  BASIC: 'پایه',
  PRO: 'حرفه‌ای',
  BUSINESS: 'تجاری',
  ENTERPRISE: 'سازمانی',
};

/** Roles. */
export const roleLabels: LabelMap = {
  SUPER_ADMIN: 'مدیر ارشد',
  ADMIN: 'مدیر',
  USER: 'کاربر',
};

/** Support ticket status. */
export const ticketStatusLabels: LabelMap = {
  OPEN: 'باز',
  IN_PROGRESS: 'در حال بررسی',
  ANSWERED: 'پاسخ داده شد',
  CLOSED: 'بسته شد',
};

/** Channel status. */
export const channelStatusLabels: LabelMap = {
  PENDING: 'در انتظار تأیید',
  ACTIVE: 'فعال',
  ERROR: 'خطا',
  DISABLED: 'غیرفعال',
  DISCONNECTED: 'قطع‌شده',
};

/** AI job status. */
export const aiJobStatusLabels: LabelMap = {
  QUEUED: 'در صف',
  PROCESSING: 'در حال پردازش',
  DONE: 'تکمیل شد',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شد',
};

/** Payment status. */
export const paymentStatusLabels: LabelMap = {
  PENDING: 'در انتظار پرداخت',
  VERIFIED: 'تأیید شد',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شد',
  EXPIRED: 'منقضی شد',
};

/** Safe label lookup — returns the raw key when unmapped (never throws). */
export function labelOf(dict: LabelMap, key: string | null | undefined): string {
  if (!key) return '—';
  return dict[key] ?? key;
}

/* ------------------------------------------------------------------ */
/* Status → badge tone                                                 */
/* ------------------------------------------------------------------ */

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_BY_STATE: Readonly<Record<string, Tone>> = {
  // success
  SENT: 'success',
  PUBLISHED: 'success',
  ACTIVE: 'success',
  DONE: 'success',
  VERIFIED: 'success',
  ANSWERED: 'success',
  // informational
  PENDING: 'info',
  PROCESSING: 'info',
  QUEUED: 'info',
  PUBLISHING: 'info',
  SCHEDULED: 'info',
  OPEN: 'info',
  IN_PROGRESS: 'info',
  // warning
  RETRYING: 'warning',
  PARTIAL: 'warning',
  // danger
  FAILED: 'danger',
  ERROR: 'danger',
  CANCELLED: 'danger',
  EXPIRED: 'danger',
  // neutral
  DRAFT: 'neutral',
  DISABLED: 'neutral',
  DISCONNECTED: 'neutral',
  CLOSED: 'neutral',
};

/** Map any state enum to a badge tone; unknown keys are neutral. */
export function statusTone(state: string | null | undefined): Tone {
  if (!state) return 'neutral';
  return TONE_BY_STATE[state] ?? 'neutral';
}
