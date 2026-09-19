import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import type { NavItem } from './nav';

/**
 * «سایر» glass bottom sheet (user feedback item 7):
 * floating glass panel anchored to the bottom edge containing ALL remaining
 * menu items (+ admin section) in an icon grid. Animated open/close with
 * pure CSS keyframes (no framer-motion). Mobile only (<lg) — auto-closes if
 * the viewport grows to desktop. RTL via logical properties; iOS home-indicator
 * safe area respected via env(safe-area-inset-bottom).
 */

/** Keep in sync with --animate-sheet-out duration (210ms) + a small buffer. */
const EXIT_MS = 240;

export interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** Non-primary user destinations. */
  items: NavItem[];
  /** Admin destinations (omitted for non-admin users). */
  adminItems?: NavItem[];
}

function GridItem({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border px-1 py-3 transition-colors duration-200',
          isActive
            ? 'border-primary-200 bg-primary-50 text-primary-800'
            : 'border-transparent text-neutral-600 hover:border-neutral-200 hover:bg-neutral-50',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'flex size-10 items-center justify-center rounded-xl transition-colors duration-200',
              isActive
                ? 'bg-primary-100 text-primary-700'
                : 'bg-neutral-100 text-neutral-500 group-hover:bg-white group-hover:text-neutral-700',
            )}
          >
            <item.icon aria-hidden="true" className="size-5" />
          </span>
          <span className="w-full truncate text-center text-[11px] font-medium leading-none">
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  );
}

export function MoreSheet({ open, onClose, items, adminItems }: MoreSheetProps) {
  // Stay mounted while the exit animation plays, then unmount.
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const t = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  // Focus, scroll lock (mirrors Dialog.tsx behavior).
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  // The sheet only exists below lg — close if the viewport grows.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) onClose();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [open, onClose]);

  if (!mounted) return null;

  let stagger = 0;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className={cn(
          'absolute inset-0 bg-neutral-900/45 backdrop-blur-[2px]',
          open ? 'animate-fade-in' : 'animate-fade-out',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="همهٔ بخش‌ها"
        tabIndex={-1}
        className={cn(
          'absolute inset-x-2 bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] flex max-h-[76dvh] flex-col rounded-3xl border border-white/70 bg-white/90 shadow-2xl shadow-neutral-900/25 outline-none backdrop-blur-2xl supports-[backdrop-filter]:bg-white/80 sm:inset-x-4',
          open ? 'animate-sheet-in' : 'animate-sheet-out',
        )}
      >
        <div className="shrink-0 px-4 pb-3 pt-2.5">
          <span
            aria-hidden="true"
            className="mx-auto mb-2.5 block h-1 w-10 rounded-full bg-neutral-300"
          />
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-neutral-900">همهٔ بخش‌ها</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن"
              className="focus-ring rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-1">
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {items.map((item) => (
              <div
                key={item.to}
                className="animate-item-in"
                style={{ animationDelay: `${Math.min(stagger++ * 24, 280)}ms` }}
              >
                <GridItem item={item} onNavigate={onClose} />
              </div>
            ))}
          </div>

          {adminItems && adminItems.length > 0 && (
            <div className="mt-4 border-t border-neutral-100 pt-3">
              <p className="mb-1.5 px-2 text-xs font-semibold text-neutral-400">مدیریت</p>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {adminItems.map((item) => (
                  <div
                    key={item.to}
                    className="animate-item-in"
                    style={{ animationDelay: `${Math.min(stagger++ * 24, 280)}ms` }}
                  >
                    <GridItem item={item} onNavigate={onClose} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
