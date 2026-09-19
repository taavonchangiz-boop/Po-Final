import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import { cn } from '../lib/cn';
import { ADMIN_NAV, MOBILE_MORE_NAV, MOBILE_PRIMARY_NAV } from './nav';
import { MoreSheet } from './MoreSheet';

/**
 * Modern floating bottom navbar (user feedback item 7) — mobile only (<lg).
 * Glass panel, 5 primary destinations + «سایر» button that opens the glass
 * bottom sheet with all remaining items. Active tab gets an animated teal
 * pill + icon lift (pure CSS transitions; no framer-motion). Safe-area aware
 * via env(safe-area-inset-bottom).
 */

const SPRING = 'ease-[cubic-bezier(0.22,1,0.36,1)]';

export function MobileNavbar({ isAdmin }: { isAdmin: boolean }) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 lg:hidden">
        <div className="px-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.625rem)]">
          <nav
            aria-label="ناوبری موبایل"
            className="pointer-events-auto mx-auto flex max-w-md items-stretch gap-0.5 rounded-2xl border border-white/70 bg-white/85 p-1.5 shadow-[0_10px_38px_-8px_rgba(28,25,23,0.35)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/75"
          >
            {MOBILE_PRIMARY_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                aria-label={item.label}
                className={({ isActive }) =>
                  cn(
                    'group relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-0.5 py-2 transition-colors duration-200',
                    isActive
                      ? 'text-primary-700'
                      : 'text-neutral-500 hover:text-neutral-800',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-0 rounded-xl bg-primary-50 ring-1 ring-inset ring-primary-100 transition-all duration-300',
                        SPRING,
                        isActive ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
                      )}
                    />
                    <item.icon
                      aria-hidden="true"
                      className={cn(
                        'relative size-5 transition-transform duration-300',
                        SPRING,
                        isActive && '-translate-y-px',
                      )}
                    />
                    <span className="relative whitespace-nowrap text-[10px] font-medium leading-none">
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}

            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-label="همهٔ بخش‌ها"
              className="group relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-0.5 py-2 text-neutral-500 transition-colors duration-200 hover:text-neutral-800 active:text-neutral-900"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 scale-75 rounded-xl bg-neutral-100 opacity-0 transition-all duration-200 group-active:scale-100 group-active:opacity-100"
              />
              <LayoutGrid aria-hidden="true" className="relative size-5" />
              <span className="relative whitespace-nowrap text-[10px] font-medium leading-none">
                سایر
              </span>
            </button>
          </nav>
        </div>
      </div>

      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={MOBILE_MORE_NAV}
        adminItems={isAdmin ? ADMIN_NAV : undefined}
      />
    </>
  );
}
