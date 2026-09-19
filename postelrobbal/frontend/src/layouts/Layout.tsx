import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { AuthModal } from '../components/AuthModal';
import { faDigits, faRelative } from '../lib/format';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import type { NotificationDto } from '../lib/api';
import { Logo } from '../components/Logo';
import { NavIcon, type NavIconName } from '../components/icons';
import { BaleIcon, RubikaIcon, TelegramIcon } from '../components/PlatformIcons';
import { Avatar } from '../components/Avatar';
import { avatarPhotoUrl } from '../lib/api';
import { ClockChip } from '../components/ClockChip';

/* ------------------------------------------------------------------ */
/* Landing shell — floating glass header + footer (Task 14-a)          */
/* ------------------------------------------------------------------ */

export function LandingLayout() {
  const { me, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (me && (location.pathname === '/' || location.search.includes('auth='))) {
      navigate('/dashboard', { replace: true });
    }
  }, [me, location, navigate]);

  useEffect(() => {
    if (location.search.includes('auth=login')) setAuthOpen(true);
    if (location.search.includes('auth=register')) { setAuthMode('register'); setAuthOpen(true); }
  }, [location.search]);

  // Close the mobile menu on navigation.
  useEffect(() => { setMenuOpen(false); }, [location.pathname, location.search]);

  // Outside click + Escape close the mobile menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('.glass-header')) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const openRegister = useCallback(() => { setAuthMode('register'); setAuthOpen(true); }, []);
  const openLogin = useCallback(() => { setAuthMode('login'); setAuthOpen(true); }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="glass-header">
        <div className="glass-header__bar">
          <Link to="/" className="glass-header__brand" aria-label="پُست‌یار — صفحهٔ اصلی">
            <Logo size={38} />
          </Link>

          <nav className="glass-header__nav" aria-label="منوی اصلی">
            <a href="#features" className="glass-header__link">امکانات</a>
            <a href="#how" className="glass-header__link">روش استفاده</a>
            <a href="#pricing" className="glass-header__link">تعرفه‌ها</a>
            <a href="#faq" className="glass-header__link">سؤالات متداول</a>
          </nav>

          <div className="glass-header__actions">
            {me ? (
              <>
                <Link to="/dashboard" className="btn btn-primary btn-sm">ورود به داشبورد</Link>
                <button className="btn btn-ghost btn-sm" onClick={() => void logout().then(() => navigate('/'))}>خروج</button>
              </>
            ) : (
              <>
                <button className="glass-header__login btn btn-ghost btn-sm" onClick={openLogin}>ورود</button>
                <button className="btn btn-primary btn-sm" onClick={openRegister}>ثبت‌نام رایگان</button>
              </>
            )}
            <button
              type="button"
              className="glass-header__burger"
              aria-label={menuOpen ? 'بستن منو' : 'باز کردن منو'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h10" />}
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="glass-header__sheet" role="dialog" aria-label="منوی موبایل">
            <nav className="glass-header__sheet-nav" aria-label="منوی اصلی موبایل">
              <a href="#features" className="glass-header__sheet-link">امکانات</a>
              <a href="#how" className="glass-header__sheet-link">روش استفاده</a>
              <a href="#pricing" className="glass-header__sheet-link">تعرفه‌ها</a>
              <a href="#faq" className="glass-header__sheet-link">سؤالات متداول</a>
            </nav>
            <div className="glass-header__sheet-actions">
              {me ? (
                <Link to="/dashboard" className="btn btn-primary btn-block">ورود به داشبورد</Link>
              ) : (
                <>
                  <button className="btn btn-ghost btn-block" onClick={() => { setMenuOpen(false); openLogin(); }}>ورود</button>
                  <button className="btn btn-primary btn-block" onClick={() => { setMenuOpen(false); openRegister(); }}>ثبت‌نام رایگان</button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main style={{ flex: 1 }}>
        <Outlet />
      </main>

      <footer className="ln-footer">
        <div className="ln-footer__grid">
          <div className="ln-footer__about">
            <Logo variant="light" size={40} />
            <p>
              سامانهٔ مدیریت هوشمند انتشار محتوا در تلگرام، بله و روبیکا؛ با ربات‌ساز، هوش مصنوعی،
              اتوماسیون و تحلیل آمار کامل.
            </p>
            <div className="ln-footer__platforms" aria-label="پلتفرم‌های پشتیبانی‌شده">
              <span className="ln-footer__platform" title="تلگرام"><TelegramIcon size={22} /></span>
              <span className="ln-footer__platform" title="بله"><BaleIcon size={22} /></span>
              <span className="ln-footer__platform" title="روبیکا"><RubikaIcon size={22} /></span>
            </div>
          </div>
          <div>
            <h3 className="ln-footer__title">دسترسی سریع</h3>
            <ul className="ln-footer__list">
              <li><a href="#features">امکانات</a></li>
              <li><a href="#how">روش استفاده</a></li>
              <li><a href="#pricing">تعرفه‌ها</a></li>
              <li><a href="#faq">سؤالات متداول</a></li>
              <li><a href="/terms">قوانین و مقررات</a></li>
            </ul>
          </div>
          <div>
            <h3 className="ln-footer__title">پلتفرم‌ها</h3>
            <ul className="ln-footer__list">
              <li className="ln-footer__platform-row"><TelegramIcon size={18} /> تلگرام</li>
              <li className="ln-footer__platform-row"><BaleIcon size={18} /> بله</li>
              <li className="ln-footer__platform-row"><RubikaIcon size={18} /> روبیکا</li>
            </ul>
          </div>
          <div>
            <h3 className="ln-footer__title">شروع کنید</h3>
            <p style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.9 }}>
              همین حالا حساب رایگان بسازید و اولین پست خود را منتشر کنید.
            </p>
            <button className="btn btn-primary btn-sm" onClick={openRegister}>ثبت‌نام رایگان</button>
          </div>
        </div>
        <div className="ln-footer__bottom">
          © {faDigits(1404)} پُست‌یار — تمامی حقوق محفوظ است.
        </div>
      </footer>

      <AuthModal open={authOpen} mode={authMode} onModeChange={setAuthMode} onClose={() => setAuthOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard shell — fixed sidebar (desktop) + bottom nav & glass      */
/* more-sheet (mobile, ≤768px). Single NAV_ITEMS source of truth.      */
/* ------------------------------------------------------------------ */

const NAV_ITEMS: Array<{ to: string; icon: NavIconName; label: string; short?: string; adminOnly?: boolean }> = [
  { to: '/dashboard', icon: 'home', label: 'وضعیت کلی', short: 'داشبورد' },
  { to: '/dashboard/channels', icon: 'channels', label: 'مدیریت کانال‌ها', short: 'کانال‌ها' },
  { to: '/dashboard/posts', icon: 'posts', label: 'انتشار پست', short: 'انتشار پست' },
  { to: '/dashboard/bots', icon: 'bots', label: 'ربات‌ها' },
  { to: '/dashboard/workflows', icon: 'workflows', label: 'گردش‌کارها' },
  { to: '/dashboard/ai', icon: 'ai', label: 'هوش مصنوعی' },
  { to: '/dashboard/woocommerce', icon: 'woocommerce', label: 'ووکامرس' },
  { to: '/dashboard/gold', icon: 'gold', label: 'ربات نرخ لحظه‌ای طلا و سکه', short: 'نرخ طلا' },
  { to: '/dashboard/analytics', icon: 'analytics', label: 'تحلیل آمار' },
  { to: '/dashboard/subscription', icon: 'subscription', label: 'اشتراک و پلن‌ها' },
  { to: '/dashboard/wallet', icon: 'wallet', label: 'کیف پول', short: 'کیف پول' },
  { to: '/dashboard/referrals', icon: 'referrals', label: 'زیرمجموعه‌گیری' },
  { to: '/dashboard/notifications', icon: 'notifications', label: 'اعلان‌ها' },
  { to: '/dashboard/support', icon: 'support', label: 'پشتیبانی و تیکت‌ها', short: 'پشتیبانی' },
  { to: '/dashboard/help', icon: 'help', label: 'آموزش و راهنما', short: 'آموزش' },
  { to: '/dashboard/settings', icon: 'settings', label: 'تنظیمات حساب', short: 'تنظیمات' },
  { to: '/dashboard/admin', icon: 'admin', label: 'پنل مدیریت', adminOnly: true },
];

/** The 4 most-used destinations pinned to the mobile bottom nav (Task 14-a). */
const BOTTOM_NAV_ROUTES = ['/dashboard', '/dashboard/posts', '/dashboard/channels', '/dashboard/wallet'];

function navMatch(pathname: string, to: string): boolean {
  return to === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(to);
}

/* Round 18-b: the ClockChip (Jalali date + 24h time) moved to the shared
   component src/components/ClockChip.tsx — the admin shell renders it too. */

/** Authenticated application shell: always-expanded sidebar on desktop,
 *  compact top bar + glass bottom navigation with «بیشتر» sheet on mobile. */
export function DashboardLayout() {
  const { loading, me, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetClosing, setSheetClosing] = useState(false);

  useEffect(() => {
    if (!loading && !me) navigate('/?auth=login', { replace: true });
  }, [loading, me, navigate]);

  useEffect(() => {
    setNotifOpen(false);
    setUserOpen(false);
    setSheetOpen(false);
    setSheetClosing(false);
  }, [location.pathname]);

  // Outside click + Escape close the topbar popovers (notifications / user menu).
  useEffect(() => {
    if (!notifOpen && !userOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('.dash-topbar__actions')) { setNotifOpen(false); setUserOpen(false); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setNotifOpen(false); setUserOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [notifOpen, userOpen]);

  const closeSheet = useCallback(() => {
    if (!sheetOpen) return;
    setSheetOpen(false);
    setSheetClosing(true);
    window.setTimeout(() => setSheetClosing(false), 260);
  }, [sheetOpen]);

  // Escape closes the mobile sheet.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSheet(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheetOpen, closeSheet]);

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!sheetOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [sheetOpen]);

  const loadNotifs = useCallback(() => {
    void api.get<{ items: NotificationDto[]; unread: number }>('/api/v1/notifications?pageSize=8')
      .then((d) => {
        setNotifs(d.items ?? []);
        setUnread(d.unread ?? 0);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (me) loadNotifs();
  }, [me, loadNotifs]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <span className="spinner spinner-lg" aria-label="در حال بارگذاری" />
      </div>
    );
  }
  if (!me) return null;

  const isAdmin = me.user.role === 'SUPER_ADMIN' || me.user.role === 'SUPPORT';
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const mainItems = BOTTOM_NAV_ROUTES
    .map((route) => visibleItems.find((item) => item.to === route))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const sheetItems = visibleItems.filter((item) => !BOTTOM_NAV_ROUTES.includes(item.to));

  /* Task 17-b: standard character / photo avatar replaces the initials box. */
  const fullName = `${me.user.firstName} ${me.user.lastName}`.trim();
  const photoUrl = me.user.avatarKind === 'photo' ? avatarPhotoUrl(me.user.id, me.user.avatarMediaId) : undefined;

  // Bottom-nav active slot: one of the 4 pinned routes, otherwise the «بیشتر» slot.
  const activeMainIdx = mainItems.findIndex((item) => navMatch(location.pathname, item.to));
  const moreActive = activeMainIdx === -1;
  const activeSlot = activeMainIdx === -1 ? mainItems.length : activeMainIdx;

  const sidebarNav = (
    <nav className="dash-nav" aria-label="منوی داشبورد">
      {visibleItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/dashboard'}
          className={({ isActive }) => `dash-nav__item${isActive ? ' is-active' : ''}`}
        >
          <NavIcon name={item.icon} size={21} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  const sheetVisible = sheetOpen || sheetClosing;

  return (
    <div className="dash-root">
      <header className="dash-topbar">
        <div className="dash-topbar__inner">
          <Link to="/dashboard" className="dash-topbar__brand" aria-label="پُست‌یار — داشبورد">
            <Logo size={34} />
          </Link>
          <div className="dash-topbar__actions">
            <ClockChip />
            <div style={{ position: 'relative' }}>
              <button
                className="dash-iconbtn"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="اعلان‌ها"
                aria-expanded={notifOpen}
              >
                <NavIcon name="notifications" size={20} />
                {unread > 0 && (
                  <span className="dash-iconbtn__badge">{faDigits(unread)}</span>
                )}
              </button>
              {notifOpen && (
                <div className="dash-notifpop">
                  <div className="dash-notifpop__head">
                    <span>اعلان‌ها</span>
                    <Link to="/dashboard/notifications">مشاهده همه</Link>
                  </div>
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {notifs.length === 0 ? (
                      <p className="dash-notifpop__empty">اعلانی ندارید.</p>
                    ) : (
                      notifs.map((n) => (
                        <div key={n.id} className="dash-notifpop__item">
                          <strong>{n.titleFa}</strong>
                          <span>{n.bodyFa.slice(0, 80)}</span>
                          <span className="dash-notifpop__time">{faRelative(n.createdAt)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <span className="dash-topbar__name">{me.user.firstName} {me.user.lastName}</span>
            <button
              className="dash-topbar__logout btn btn-ghost btn-sm"
              onClick={() => void logout().then(() => { toast.success('با موفقیت خارج شدید.'); navigate('/'); })}
            >
              خروج
            </button>
            {/* User avatar button (topbar): opens the compact user menu */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="dash-avatar"
                onClick={() => setUserOpen((v) => !v)}
                aria-label="منوی کاربر"
                aria-expanded={userOpen}
              >
                <Avatar
                  kind={me.user.avatarKind}
                  value={me.user.avatarValue}
                  photoUrl={photoUrl}
                  name={fullName}
                  size={36}
                />
              </button>
              {userOpen && (
                <div className="dash-userpop" role="menu" aria-label="منوی کاربر">
                  <div className="dash-userpop__id">
                    <Avatar
                      kind={me.user.avatarKind}
                      value={me.user.avatarValue}
                      photoUrl={photoUrl}
                      name={fullName}
                      size={44}
                    />
                    <div>
                      <strong>{me.user.firstName} {me.user.lastName}</strong>
                      <span dir="ltr">{me.user.email}</span>
                    </div>
                  </div>
                  <Link
                    to="/dashboard/settings"
                    className="dash-userpop__row"
                    role="menuitem"
                    onClick={() => setUserOpen(false)}
                  >
                    <NavIcon name="settings" size={17} />
                    تنظیمات حساب
                  </Link>
                  <button
                    type="button"
                    className="dash-userpop__row dash-userpop__row--danger"
                    role="menuitem"
                    onClick={() => {
                      setUserOpen(false);
                      void logout().then(() => { toast.success('با موفقیت خارج شدید.'); navigate('/'); });
                    }}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <path d="M16 17l5-5-5-5" />
                      <path d="M21 12H9" />
                    </svg>
                    خروج از حساب
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="dash-shell">
        <aside className="dash-sidebar">
          {sidebarNav}
        </aside>
        <main className="dash-main">
          <Outlet />
        </main>
      </div>

      <footer className="dash-footer hide-mobile">
        پُست‌یار — انتشار هوشمند در تلگرام، بله و روبیکا © {faDigits(1404)}
      </footer>

      {/* Mobile bottom navigation (≤768px, CSS-hidden on desktop) */}
      <nav className="bottomnav" aria-label="ناوبری موبایل">
        <span
          className="bottomnav__indicator"
          style={{ '--i': activeSlot } as CSSProperties}
          aria-hidden="true"
        />
        {mainItems.map((item) => {
          const active = navMatch(location.pathname, item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`bottomnav__slot${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <NavIcon name={item.icon} size={22} />
              <span className="bottomnav__label">{item.short ?? item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`bottomnav__slot bottomnav__slot--btn${moreActive ? ' is-active' : ''}`}
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          <NavIcon name="more" size={22} />
          <span className="bottomnav__label">بیشتر</span>
        </button>
      </nav>

      {/* Glass «بیشتر» sheet with all remaining destinations */}
      {sheetVisible && (
        <div className={`dash-sheet${sheetOpen ? ' is-open' : ' is-closing'}`}>
          <div className="dash-sheet__backdrop" onClick={closeSheet} aria-hidden="true" />
          <div className="dash-sheet__panel" role="dialog" aria-modal="true" aria-label="سایر بخش‌های داشبورد">
            <span className="dash-sheet__grabber" aria-hidden="true" />
            <div className="dash-sheet__head">
              <strong>سایر بخش‌ها</strong>
              <button type="button" className="dash-iconbtn" onClick={closeSheet} aria-label="بستن">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="dash-sheet__grid">
              {sheetItems.map((item, i) => {
                const active = navMatch(location.pathname, item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`dash-sheet__item${active ? ' is-active' : ''}`}
                    style={{ '--d': i } as CSSProperties}
                  >
                    <span className="dash-sheet__tile"><NavIcon name={item.icon} size={22} /></span>
                    <span className="dash-sheet__label">{item.short ?? item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
