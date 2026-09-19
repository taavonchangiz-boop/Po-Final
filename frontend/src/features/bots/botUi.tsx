import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';

/**
 * Bot feature shared UI (task 4-d-1): error card, plan-limit banner and an
 * RTL-safe switch toggle used by BotsPage, BotDetailPage tabs and the
 * WorkflowsPage active toggle.
 */

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-red-200">
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-red-700">{message}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="size-4" />
          تلاش مجدد
        </Button>
      </CardBody>
    </Card>
  );
}

export function PlanLimitBanner({ message }: { message: string }) {
  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-amber-800">{message}</p>
        <Link
          to="/app/subscription"
          className="focus-ring inline-flex h-8 shrink-0 items-center rounded-lg bg-amber-600 px-3 text-xs font-medium text-white hover:bg-amber-700"
        >
          ارتقای پلن
        </Link>
      </CardBody>
    </Card>
  );
}

export interface SwitchToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Persian accessible label, e.g. 'گردش‌کار فعال'. */
  label: string;
  className?: string;
}

/** Accessible switch (role=switch) — logical `start/end` insets keep it RTL-safe. */
export function SwitchToggle({ checked, onChange, disabled, label, className }: SwitchToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary-700' : 'bg-neutral-300',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-all',
          checked ? 'end-0.5' : 'start-0.5',
        )}
      />
    </button>
  );
}
