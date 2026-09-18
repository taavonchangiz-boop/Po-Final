import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

const SIZE = {
  sm: 'size-4',
  md: 'size-6',
  lg: 'size-9',
} as const;

export function Spinner({ size = 'md', label = 'در حال بارگذاری', className }: SpinnerProps) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn('animate-spin text-primary-700', SIZE[size], className)}
    />
  );
}

/** Centered full-block spinner used for lazy route + guard fallbacks. */
export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center" role="status">
      <Spinner size="lg" label={label ?? 'در حال بارگذاری…'} />
      <span className="sr-only">در حال بارگذاری…</span>
    </div>
  );
}
