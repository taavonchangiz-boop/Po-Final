import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { labelOf, statusTone, type LabelMap, type Tone } from '../../lib/format';

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-800',
  neutral: 'bg-neutral-100 text-neutral-700',
};

export interface BadgeProps {
  children?: ReactNode;
  /** Renders the Persian label for a state enum with its mapped tone. */
  state?: string;
  /** Persian label map to resolve `state` with (e.g. stateLabels, postStatusLabels). */
  labels?: LabelMap;
  tone?: Tone;
  className?: string;
}

/**
 * Status badge. Two usages:
 *  - `<Badge state="SENT" labels={stateLabels} />` → 'ارسال شد' (green)
 *  - `<Badge tone="info">متن دلخواه</Badge>`
 * When `state` is set, tone comes from the shared statusTone() map.
 */
export function Badge({ children, state, labels, tone, className }: BadgeProps) {
  const resolvedTone: Tone = state ? statusTone(state) : (tone ?? 'neutral');
  const content = state ? labelOf(labels ?? {}, state) : children;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[resolvedTone],
        className,
      )}
    >
      {content}
    </span>
  );
}
