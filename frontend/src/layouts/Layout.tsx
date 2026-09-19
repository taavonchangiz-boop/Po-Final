import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { AuthModal } from '../components/AuthModal';
import { faDigits, faRelative } from '../lib/format';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import type { NotificationDto } from '../lib/api';

/** Landing shell: header + footer, sticky footer rule (min-h-screen flex + mt-auto). */
export function LandingLayout() {
  const { me, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot'>('login');

  useEffect(() => {
    if (me && (location.pathname === '/' || location.search.includes('auth='))) {
      navigate('/dashboard', { replace: true });
    }
  }, [me, location, navigate]);

  useEffect(() => {
    if (location.search.includes('auth=login')) setAuthOpen(true);
    if (location.search.includes('auth=register')) { setAuthMode('register'); setAuthOpen(true); }
  }, [location.search]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px', height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="./images/logo.webp" alt="لوگوی پُستیار" width={40} height={40} style={{ borderRadius: 10 }} />
            <span style={{ fontSize: 19, fontWeight: 900, color: 'var(--text)' }}>پُستیار</span>
          </Link>
          <nav aria-label="منوی اصلی" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <a href="#features" className="btn btn-ghost btn-sm" style={{ display: 'none' }} aria-hidden="true" />
            <a href="#features" className="btn btn-ghost btn-sm hide-mobile">امکانات</a>
            <a href="#pricing" className="btn btn-ghost btn-sm hide-mobile">تعرفه‌ها</a>
            <a href="#faq" className="btn btn-ghost btn-sm hide-mobile">سؤالات متداول</a>
            {me ? (
              <>
                <Link to="/dashboard" className="btn btn-primary btn-sm">ورود به داشبورد</Link>
                <button className="btn btn-ghost btn-sm" onClick={() => void logout().then(() => navigate('/'))}>خروج</button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => { setAuthMode('login'); setAuthOpen(true); }}>ورود</button>
                <button className="btn btn-primary btn-sm" onClick={() => { setAuthMode('register'); setAuthOpen(true); }}>ثبت‌نام رایگان</button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main style={{ flex: 1 }}>
        <Outlet />
      </main>

      <footer style={{ marginTop: 'auto', background: '#14161f', color: '#a7adbf', padding: '44px 20px 28px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gap: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <img src="./images/logo-white-bg.webp" alt="لوگوی پُستیار" width={38} height={38} style={{ borderRadius: 10 }} />
              <span style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>پُستیار</span>
            </div>
            <p style={{ fontSize: 13, lineHeight: 2 }}>
              سامانهٔ مدیریت هوشمند انتشار محتوا در تلگرام، بله و روبیکا؛ با ربات‌ساز، هوش مصنوعی، اتوماسیون و تحلیل آمار کامل.
            </p>
          </div>
          <div>
            <h3 style={{ color: '#fff', fontSize: 14.5, marginBottom: 12 }}>دسترسی سریع</h3>
            <ul style={{ listStyle: 'none', display: 'grid', gap: 8, fontSize: 13.5 }}>
              <li><a href="#features" style={{ color: '#a7adbf' }}>امکانات</a></li>
              <li><a href="#how" style={{ color: '#a7adbf' }}>روش استفاده</a></li>
              <li><a href="#pricing" style={{ color: '#a7adbf' }}>تعرفه‌ها</a></li>
              <li><a href="#faq" style={{ color: '#a7adbf' }}>سؤالات متداول</a></li>
            </ul>
          </div>
          <div>
            <h3 style={{ color: '#fff', fontSize: 14.5, marginBottom: 12 }}>پلتفرم‌های پشتیبانی‌شده</h3>
            <ul style={{ listStyle: 'none', display: 'grid', gap: 8, fontSize: 13.5 }}>
              <li>تلگرام</li>
              <li>بله</li>
              <li>روبیکا</li>
            </ul>
          </div>
          <div>
            <h3 style={{ color: '#fff', fontSize: 14.5, marginBottom: 12 }}>شروع کنید</h3>
            <p style={{ fontSize: 13, marginBottom: 12 }}>همین حالا حساب رایگان بسازید و اولین پست خود را منتشر کنید.</p>
            <button className="btn btn-primary btn-sm" onClick={() => { setAuthMode('register'); setAuthOpen(true); }}>ثبت‌نام رایگان</button>
          </div>
        </div>
        <div style={{ maxWidth: 1200, margin: '28px auto 0', paddingTop: 18, borderTop: '1px solid #262938', fontSize: 12.5, textAlign: 'center' }}>
          © {faDigits(1404)} پُستیار — تمامی حقوق محفوظ است.
        </div>
      </footer>

      <AuthModal open={authOpen} mode={authMode} onModeChange={setAuthMode} onClose={() => setAuthOpen(false)} />
    </div>
  );
}

const NAV_ITEMS: Array<{ to: string; icon: string; label: string; adminOnly?: boolean }> = [
  { to: '/dashboard', icon: '🏠', label: 'وضعیت کلی' },
  { to: '/dashboard/channels', icon: '📻', label: 'مدیریت کانال‌ها' },
  { to: '/dashboard/posts', icon: '✉️', label: 'انتشار پست' },
  { to: '/dashboard/bots', icon: '🤖', label: 'ربات‌ها' },
  { to: '/dashboard/workflows', icon: '🔀', label: 'گردش‌کارها' },
  { to: '/dashboard/ai', icon: '🧠', label: 'هوش مصنوعی' },
  { to: '/dashboard/woocommerce', icon: '🛍️', label: 'ووکامرس' },
  { to: '/dashboard/gold', icon: '🪙', label: 'ربات نرخ لحظه‌ای طلا و سکه' },
  { to: '/dashboard/analytics', icon: '📊', label: 'تحلیل آمار' },
  { to: '/dashboard/subscription', icon: '💎', label: 'اشتراک و پلن‌ها' },
  { to: '/dashboard/wallet', icon: '💰', label: 'کیف پول' },
  { to: '/dashboard/referrals', icon: '🎯', label: 'زیرمجموعه‌گیری' },
  { to: '/dashboard/notifications', icon: '🔔', label: 'اعلان‌ها' },
  { to: '/dashboard/support', icon: '🎫', label: 'پشتیبانی و تیکت‌ها' },
  { to: '/dashboard/settings', icon: '⚙️', label: 'تنظیمات حساب' },
  { to: '/dashboard/admin', icon: '👑', label: 'پنل مدیریت', adminOnly: true },
];

/** Authenticated application shell with responsive sidebar + notifications. */
export function DashboardLayout() {
  const { loading, me, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!loading && !me) navigate('/?auth=login', { replace: true });
  }, [loading, me, navigate]);

  useEffect(() => {
    setSidebarOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

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

  const nav = (
    <nav aria-label="منوی داشبورد" style={{ display: 'grid', gap: 3 }}>
      {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/dashboard'}
          style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 11, padding: '10px 14px',
            borderRadius: 10, fontSize: 13.5, fontWeight: isActive ? 700 : 500,
            color: isActive ? 'var(--brand-strong)' : 'var(--text-2)',
            background: isActive ? 'var(--brand-soft)' : 'transparent',
          })}
        >
          <span aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ padding: '0 16px', height: 62, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setSidebarOpen((v) => !v)} aria-label="باز و بسته کردن منو" style={{ display: 'inline-flex' }}>☰</button>
            <Link to="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src="./images/logo.webp" alt="لوگوی پُستیار" width={34} height={34} style={{ borderRadius: 9 }} />
              <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>پُستیار</span>
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setNotifOpen((v) => !v)} aria-label="اعلان‌ها">
                🔔
                {unread > 0 && (
                  <span style={{ position: 'absolute', top: -4, left: -4, background: 'var(--danger)', color: '#fff', borderRadius: 999, fontSize: 10.5, padding: '1px 6px', fontWeight: 700 }}>
                    {faDigits(unread)}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div style={{ position: 'absolute', top: 46, left: 0, width: 320, maxWidth: 'calc(100vw - 32px)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', zIndex: 60 }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13.5, display: 'flex', justifyContent: 'space-between' }}>
                    <span>اعلان‌ها</span>
                    <Link to="/dashboard/notifications" style={{ fontSize: 12 }}>مشاهده همه</Link>
                  </div>
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {notifs.length === 0 ? (
                      <p style={{ padding: 20, textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>اعلانی ندارید.</p>
                    ) : (
                      notifs.map((n) => (
                        <div key={n.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                          <strong style={{ display: 'block', fontSize: 13 }}>{n.titleFa}</strong>
                          <span style={{ color: 'var(--text-2)' }}>{n.bodyFa.slice(0, 80)}</span>
                          <span style={{ display: 'block', color: 'var(--text-2)', fontSize: 11.5, marginTop: 3 }}>{faRelative(n.createdAt)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <div style={{ textAlign: 'left', display: 'none' }} className="hide-desktop" />
            <span className="hide-mobile" style={{ fontSize: 13, fontWeight: 600 }}>{me.user.firstName} {me.user.lastName}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void logout().then(() => { toast.success('با موفقیت خارج شدید.'); navigate('/'); })}
            >
              خروج
            </button>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        <aside
          className="sidebar"
          style={{
            width: 262, flexShrink: 0, padding: '18px 12px', borderLeft: '1px solid var(--border)',
            background: 'var(--surface)', maxHeight: 'calc(100vh - 62px)', overflowY: 'auto', position: 'sticky', top: 62,
          }}
        >
          {nav}
        </aside>
        <main style={{ flex: 1, padding: '22px 20px', minWidth: 0 }}>
          <Outlet />
        </main>
      </div>

      <footer style={{ marginTop: 'auto', background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '14px 20px', textAlign: 'center', fontSize: 12.5, color: 'var(--text-2)' }}>
        پُستیار — انتشار هوشمند در تلگرام، بله و روبیکا © {faDigits(1404)}
      </footer>

      {sidebarOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(16,18,28,0.4)' }}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        >
          <div
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 270, background: 'var(--surface)', padding: '18px 12px', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="منوی داشبورد"
          >
            {nav}
          </div>
        </div>
      )}
    </div>
  );
}
