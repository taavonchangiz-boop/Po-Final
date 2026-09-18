/**
 * Jalali (Solar Hijri) calendar kernel — server-side Persian formatting helpers.
 *
 * Standard "jalaali" algorithm (Borkowski / jalaali-js Breaks & Delorean method),
 * implemented dependency-free so the backend can produce Persian dates for
 * notifications, logs and payment descriptions without a runtime library.
 *
 * All functions are pure. Years 1178–1633 Jalali (≈1799–2254 CE) are supported;
 * outside that range an error is thrown (callers must handle or clamp).
 */

const BREAKS: readonly number[] = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

interface JalCalResult {
  leap: number;
  gy: number;
  march: number;
}

function jalCal(jy: number, withoutLeap: boolean): JalCalResult {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0] ?? -61;
  let jump = 0;
  let leap = 0;

  if (jy < jp || jy >= (BREAKS[bl - 1] ?? 3178)) {
    throw new Error(`Invalid Jalali year ${jy}`);
  }

  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i] ?? jp;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (!withoutLeap) {
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
  }

  return { leap, gy, march };
}

/** Gregorian date → Jalali day number (Julian day based, long algorithm). */
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** Jalali day number → Gregorian date parts. */
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** Jalali day number → Jalali date parts. */
function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy, false);
  const jdn1f = g2d(r.gy, 3, r.march);
  let k = jdn - jdn1f;

  if (k >= 0) {
    if (k <= 185) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }

  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

/** Jalali date parts → Jalali day number. */
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

export interface GregorianDate {
  gy: number;
  gm: number;
  gd: number;
}

/** Low-level conversion from Gregorian year/month/day (1-based month). */
export function toJalaliFromYMD(gy: number, gm: number, gd: number): JalaliDate {
  return d2j(g2d(gy, gm, gd));
}

/** Convert a JS Date (UTC or local — components are read in local time) to Jalali. */
export function toJalali(date: Date): JalaliDate {
  return toJalaliFromYMD(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Low-level conversion from Jalali year/month/day to Gregorian. */
export function toGregorian(jy: number, jm: number, jd: number): GregorianDate {
  return d2g(j2d(jy, jm, jd));
}

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** Convert ASCII digits in a number/string to Persian digits (pure). */
export function faDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)] ?? d);
}

/** Group a number with thousands separators then Persian digits: 1234567 → ۱٬۲۳۴٬۵۶۷ */
export function faNumber(value: number): string {
  const grouped = Math.trunc(value).toLocaleString('en-US');
  return faDigits(grouped.replace(/,/g, '٬'));
}

/** Rial money formatting: 1234567 → «۱٬۲۳۴٬۵۶۷ ریال» */
export function faMoney(value: number): string {
  return `${faNumber(value)} ریال`;
}

const JALALI_MONTHS = [
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

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Numeric Jalali date «۱۴۰۳/۱۰/۱۵» from a JS Date. */
export function faJalaliDate(date: Date): string {
  const { jy, jm, jd } = toJalali(date);
  return faDigits(`${jy}/${pad2(jm)}/${pad2(jd)}`);
}

/** Long Persian Jalali date «۱۵ دی ۱۴۰۳» from a JS Date (notification bodies). */
export function faJalaliDateLong(date: Date): string {
  const { jy, jm, jd } = toJalali(date);
  return `${faDigits(jd)} ${JALALI_MONTHS[jm - 1] ?? ''} ${faDigits(jy)}`;
}
