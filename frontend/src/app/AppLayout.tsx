import { useEffect, useRef, useState, Suspense } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut } from 'lucide-react';
import { cn } from '../lib/cn';
import { post, ApiError } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { faNumber, labelOf, roleLabels } from '../lib/format';
import { useMe, ME_QUERY_KEY } from './guards';
import { usePageTitle } from './usePageTitle';
import { Logo } from '../components/Logo';
import { MobileNavbar } from '../components/MobileNavbar';
import { ADMIN_NAV, MAIN_NAV, type NavItem } from '../components/nav';
import { FullPageSpinner, Spinner } from '../components/ui/Spinner';

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'focus-ring flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary-50 font-medium text-primary-800'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
              )
            }
          >
            <item.icon aria-hidden="true" className="size-[18px] shrink-0" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function SidebarContent({ isAdmin }: { isAdmin: boolean }) {
  return (
    <nav aria-label="فهرست اصلی" className="flex-1 overflow-y-auto px-3 py-4">
      <NavList items={MAIN_NAV} />
      {isAdmin && (
        <div className="mt-6">
          <p className="mb-1.5 px-3 text-xs font-semibold text-neutral-400">مدیریت</p>
          <NavList items={ADMIN_NAV} />
        </div>
      )}
    </nav>
  );
}

function UserMenu({ onLogout, loggingOut }: { onLogout: () => void; loggingOut: boolean }) {
  const { data } = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const user = data?.user;
  const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : 'حساب کاربری';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="منوی حساب کاربری"
        className="focus-ring flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-100/80"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-800">
          {(user?.firstName ?? 'پ').charAt(0)}
        </span>
        <span className="hidden max-w-32 truncate md:inline">{fullName}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn('size-4 text-neutral-400 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full z-40 mt-2 w-56 rounded-2xl border border-neutral-200/80 bg-white/90 p-1.5 shadow-xl shadow-neutral-900/10 backdrop-blur-xl"
        >
          <div className="border-b border-neutral-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-neutral-900">{fullName}</p>
            {user && (
              <p className="mt-0.5 text-xs text-neutral-500">
                {labelOf(roleLabels, user.role)}
                {user.businessName ? ` · ${user.businessName}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            disabled={loggingOut}
            className="focus-ring mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
          >
            {loggingOut ? <Spinner size="sm" label="در حال خروج" /> : <LogOut aria-hidden="true" className="size-4" />}
            خروج از حساب
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * RTL app shell (redesigned per user feedback items 4–7):
 * - Desktop (lg+): permanent sidebar (no toggle, no collapsed state) + floating
 *   glass sticky header panel inset from the top/sides.
 * - Mobile/tablet (<lg): sticky floating header + floating glass bottom navbar
 *   with a «سایر» glass bottom sheet holding all remaining destinations.
 */
export default function AppLayout() {
  usePageTitle('نمای کلی');
  const { data } = useMe();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  // GET /me returns unreadNotifications at the top level (no tenant wrapper).
  const unread = data?.unreadNotifications ?? 0;
  const isAdmin = data?.user.role === 'ADMIN' || data?.user.role === 'SUPER_ADMIN';

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await post('/auth/logout');
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
      queryClient.clear();
      navigate('/', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Session already gone server-side — treat as logged out.
        queryClient.clear();
        navigate('/', { replace: true });
      }
      // other failures: stay; the api layer surfaces system toasts where wired
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar — always visible on lg+ (start side in RTL = right).
          No collapse/hamburger on desktop: the toggle was removed entirely. */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-neutral-200 bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-neutral-100 px-5">
          <Logo variant="full" />
        </div>
        <SidebarContent isAdmin={isAdmin === true} />
        <div className="border-t border-neutral-100 px-5 py-3 text-[11px] text-neutral-400">
          © پُست‌یار ۱۴۰۳
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Floating glass header — sticky, inset from top and sides (item 5). */}
        <header className="sticky top-0 z-30">
          <div className="mx-auto w-full max-w-7xl px-2 pt-2 sm:px-4 sm:pt-3">
            <div className="flex h-14 items-center gap-1.5 rounded-2xl border border-white/70 bg-white/85 px-2 shadow-lg shadow-neutral-900/[0.07] backdrop-blur-xl supports-[backdrop-filter]:bg-white/72 sm:h-16 sm:gap-2 sm:px-4">
              <div className="lg:hidden">
                <Logo variant="square" />
              </div>
              <div className="flex-1" />
              <NavLink
                to="/app/notifications"
                aria-label={`اعلان‌ها${unread > 0 ? `، ${faNumber(unread)} خوانده‌نشده` : ''}`}
                className={({ isActive }) =>
                  cn(
                    'focus-ring relative rounded-xl p-2 text-neutral-600 transition-colors hover:bg-neutral-100',
                    isActive && 'text-primary-700',
                  )
                }
              >
                <Bell aria-hidden="true" className="size-5" />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -end-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {faNumber(unread)}
                  </span>
                )}
              </NavLink>
              <UserMenu onLogout={handleLogout} loggingOut={loggingOut} />
            </div>
          </div>
        </header>

        {/* Bottom padding below lg clears the floating mobile navbar + safe area. */}
        <main className="flex-1 px-3 py-4 pb-[calc(env(safe-area-inset-bottom,0px)+6.75rem)] sm:px-4 sm:py-6 lg:px-8 lg:pb-8">
          <div className="mx-auto w-full max-w-6xl">
            <Suspense fallback={<FullPageSpinner />}>
              <Outlet />
            </Suspense>
          </div>
        </main>

        <footer className="border-t border-neutral-200 px-4 py-3 text-center text-xs text-neutral-400 lg:px-8">
          © پُست‌یار ۱۴۰۳
        </footer>
      </div>

      {/* Mobile floating bottom navbar + «سایر» sheet (<lg only). */}
      <MobileNavbar isAdmin={isAdmin === true} />
    </div>
  );
}
