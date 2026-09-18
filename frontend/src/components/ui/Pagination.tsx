import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { faNumber } from '../../lib/format';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  className?: string;
}

/** Window of page numbers around the current one, max 5. */
function pageWindow(page: number, totalPages: number): number[] {
  const span = 5;
  let start = Math.max(1, page - Math.floor(span / 2));
  const end = Math.min(totalPages, start + span - 1);
  start = Math.max(1, end - span + 1);
  const out: number[] = [];
  for (let p = start; p <= end; p++) out.push(p);
  return out;
}

/** RTL pagination with Persian digits (۱ از ۵). */
export function Pagination({ page, totalPages, onChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;
  const pages = pageWindow(page, totalPages);
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <nav
      aria-label="صفحه‌بندی"
      className={cn('flex items-center justify-center gap-1.5', className)}
    >
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={prevDisabled}
        aria-label="صفحه قبلی"
        className="focus-ring inline-flex size-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-40"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-label={`صفحه ${faNumber(p)}`}
          aria-current={p === page ? 'page' : undefined}
          className={cn(
            'focus-ring inline-flex size-9 items-center justify-center rounded-lg border text-sm transition-colors',
            p === page
              ? 'border-primary-700 bg-primary-700 font-medium text-white'
              : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
          )}
        >
          {faNumber(p)}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={nextDisabled}
        aria-label="صفحه بعدی"
        className="focus-ring inline-flex size-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-40"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
    </nav>
  );
}
