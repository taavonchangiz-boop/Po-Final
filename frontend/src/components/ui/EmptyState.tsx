import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  icon?: LucideIcon;
  /** Persian headline, e.g. 'هنوز کانالی متصل نکرده‌اید'. */
  title: string;
  /** Persian guidance text. */
  description?: string;
  /** Optional call-to-action (Button / link). */
  action?: ReactNode;
  className?: string;
}

/** Honest empty state: icon + Persian title + guidance + optional action. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-neutral-300 bg-white px-6 py-14 text-center',
        className,
      )}
    >
      {Icon && (
        <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary-50">
          <Icon aria-hidden="true" className="size-7 text-primary-700" />
        </span>
      )}
      <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
