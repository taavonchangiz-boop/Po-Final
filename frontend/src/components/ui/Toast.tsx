import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useUiStore, type ToastType } from '../../store/ui';

const ICONS: Record<ToastType, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const STYLES: Record<ToastType, string> = {
  success: 'border-green-200 bg-green-50 text-green-800',
  error: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
};

const ROLE: Record<ToastType, 'status' | 'alert'> = {
  success: 'status',
  info: 'status',
  error: 'alert',
};

/** Renders the toast stack from the UI store. Mount once (hosted in main.tsx). */
export function ToastViewport() {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);

  return (
    <div
      aria-live="polite"
      aria-label="پیام‌های سیستم"
      className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:bottom-6 sm:start-6 sm:w-80"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.type];
        return (
          <div
            key={t.id}
            role={ROLE[t.type]}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-lg',
              STYLES[t.type],
            )}
          >
            <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <p className="flex-1 text-sm leading-6">{t.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="بستن پیام"
              className="focus-ring rounded-md p-0.5 opacity-60 transition-opacity hover:opacity-100"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
