import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  /** Persian accessible name for the tablist. */
  ariaLabel?: string;
  className?: string;
}

export function Tabs({ items, active, onChange, ariaLabel, className }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-neutral-100 p-1', className)}
    >
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.key)}
            className={cn(
              'focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-white text-primary-800 shadow-sm'
                : 'text-neutral-600 hover:text-neutral-900',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
