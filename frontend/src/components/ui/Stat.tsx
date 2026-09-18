import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface StatProps {
  /** Persian KPI label, e.g. 'پست‌های ارسال‌شده'. */
  label: string;
  /** Pre-formatted Persian value (use faNumber/faMoney/faPercent). */
  value: ReactNode;
  icon?: LucideIcon;
  /** Optional Persian footnote, e.g. '۱۴ روز گذشته'. */
  hint?: string;
  className?: string;
}

/** KPI card for overview + admin dashboards. */
export function Stat({ label, value, icon: Icon, hint, className }: StatProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-card border border-neutral-200 bg-white p-5 shadow-sm',
        className,
      )}
    >
      {Icon && (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-50">
          <Icon aria-hidden="true" className="size-5 text-primary-700" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs text-neutral-500">{label}</p>
        <p className="mt-1 truncate text-xl font-bold text-neutral-900">{value}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-neutral-400">{hint}</p>}
      </div>
    </div>
  );
}
