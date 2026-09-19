import { useEffect, useState } from 'react';
import { jalaaliMonthLength } from 'jalaali-js';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import {
  JALALI_MONTHS,
  faDate,
  jalaliToGregorianISO,
  toEn,
  toFa,
  toJalali,
} from '../../lib/format';

/**
 * Jalali datetime picker (task 4-d-1) — day/month/year selects + HH:mm inputs.
 * Converts through the shared formatting kernel (jalaali-js) and exports a
 * UTC ISO string (API contract: scheduleAt is ISO UTC with offset; Z accepted).
 */

export interface JalaliPickerProps {
  /** Controlled ISO datetime (UTC). */
  value: string | null;
  onChange: (iso: string | null) => void;
  /** Accessible label prefix for the fieldset. */
  ariaLabel?: string;
}

interface Parts {
  jy: number;
  jm: number;
  jd: number;
  hh: number;
  mm: number;
}

const MIN_YEAR = 1403;
const MAX_YEAR = 1410;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Default = one hour ahead on the hour (useful schedule default). */
function defaultParts(): Parts {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const { jy, jm, jd } = toJalali(d);
  return { jy, jm, jd, hh: d.getHours(), mm: 0 };
}

function partsFromIso(iso: string | null): Parts {
  if (!iso) return defaultParts();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return defaultParts();
  const { jy, jm, jd } = toJalali(d);
  return { jy, jm, jd, hh: d.getHours(), mm: d.getMinutes() };
}

export function JalaliPicker({ value, onChange, ariaLabel = 'انتخاب تاریخ جلالی' }: JalaliPickerProps) {
  const [parts, setParts] = useState<Parts>(() => partsFromIso(value));

  // Re-derive when the external value changes (dialog open / reset).
  useEffect(() => {
    setParts(partsFromIso(value));
  }, [value]);

  const years = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i);
  const monthLength = jalaaliMonthLength(parts.jy, parts.jm);
  const days = Array.from({ length: monthLength }, (_, i) => i + 1);

  function update(patch: Partial<Parts>) {
    const next = { ...parts, ...patch };
    // Keep the day valid when the month/year changes (e.g. ۳۱ → اسفند).
    const maxDay = jalaaliMonthLength(next.jy, next.jm);
    next.jd = clamp(next.jd, 1, maxDay);
    next.hh = clamp(Math.floor(next.hh), 0, 23);
    next.mm = clamp(Math.floor(next.mm), 0, 59);
    setParts(next);
    const date = jalaliToGregorianISO(next.jy, next.jm, next.jd, next.hh, next.mm);
    onChange(date.toISOString());
  }

  function parseTimeField(raw: string, kind: 'hh' | 'mm') {
    const digits = toEn(raw).replace(/\D/g, '');
    const n = digits.length === 0 ? 0 : clamp(parseInt(digits, 10), 0, kind === 'hh' ? 23 : 59);
    update(kind === 'hh' ? { hh: n } : { mm: n });
  }

  const previewDate = jalaliToGregorianISO(parts.jy, parts.jm, parts.jd, parts.hh, parts.mm);

  return (
    <fieldset
      aria-label={ariaLabel}
      className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4"
    >
      <legend className="px-1 text-sm font-medium text-neutral-700">تاریخ و ساعت انتشار</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Select
          label="سال"
          value={String(parts.jy)}
          onChange={(e) => update({ jy: Number(e.target.value) })}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {toFa(y)}
            </option>
          ))}
        </Select>
        <Select
          label="ماه"
          value={String(parts.jm)}
          onChange={(e) => update({ jm: Number(e.target.value) })}
        >
          {JALALI_MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          label="روز"
          value={String(parts.jd)}
          onChange={(e) => update({ jd: Number(e.target.value) })}
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {toFa(d)}
            </option>
          ))}
        </Select>
        <Input
          label="ساعت"
          dir="ltr"
          inputMode="numeric"
          maxLength={2}
          value={toFa(pad2(parts.hh))}
          onChange={(e) => parseTimeField(e.target.value, 'hh')}
          onBlur={(e) => {
            if (e.target.value.trim() === '') update({ hh: 0 });
          }}
        />
        <Input
          label="دقیقه"
          dir="ltr"
          inputMode="numeric"
          maxLength={2}
          value={toFa(pad2(parts.mm))}
          onChange={(e) => parseTimeField(e.target.value, 'mm')}
          onBlur={(e) => {
            if (e.target.value.trim() === '') update({ mm: 0 });
          }}
        />
        <div className="col-span-2 flex items-end sm:col-span-1">
          <p className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-neutral-700 ring-1 ring-inset ring-neutral-200">
            <span className="block text-xs text-neutral-400">پیش‌نمایش</span>
            <span className="mt-0.5 block font-medium">
              {faDate(previewDate)}، {toFa(`${pad2(parts.hh)}:${pad2(parts.mm)}`)}
            </span>
          </p>
        </div>
      </div>
    </fieldset>
  );
}
