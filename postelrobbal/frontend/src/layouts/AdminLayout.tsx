import { Link, Navigate, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { PageLoading } from '../components/ui';
import { NavIcon } from '../components/icons';
import { ADMIN_SECTIONS } from '../pages/admin/shared';
import '../styles/admin.css';

/* ------------------------------------------------------------------ */
/* Admin shell (Task 16-b): role-guarded nested layout under           */
/* /dashboard/admin with its own RTL sidebar (right side on desktop,   */
/* horizontal scrollable chips row on mobile).                         */
/* ------------------------------------------------------------------ */

export default function AdminLayout() {
  const { loading, me } = useAuth();

  if (loading) return <PageLoading />;
  if (!me) return <Navigate to="/?auth=login" replace />;

  const role = me.user.role;
  if (role !== 'SUPER_ADMIN' && role !== 'SUPPORT') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="adm-root">
      <header className="adm-topbar">
        <div className="adm-topbar__id">
          <span className="adm-topbar__badge" aria-hidden="true">
            <NavIcon name="admin" size={22} />
          </span>
          <div>
            <h1 className="adm-topbar__title">پنل مدیریت پُست‌یار</h1>
            <p className="adm-topbar__sub">
              {role === 'SUPER_ADMIN' ? 'دسترسی کامل مدیریتی' : 'دسترسی پشتیبانی'} — {me.user.firstName} {me.user.lastName}
            </p>
          </div>
        </div>
        {/* Switch between admin panel and the user dashboard, both ways. */}
        <Link to="/dashboard" className="btn btn-primary adm-topbar__back">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3.5 10.5 12 3.5l8.5 7" />
            <path d="M5.5 9.6V20h13V9.6" />
            <path d="M9.5 20v-6h5v6" />
          </svg>
          بازگشت به پیشخوان
        </Link>
      </header>

      <div className="adm-body">
        <aside className="adm-sidebar">
          <nav className="adm-nav" aria-label="بخش‌های پنل مدیریت">
            {ADMIN_SECTIONS.map((s) => (
              <NavLink
                key={s.to}
                to={s.to}
                end={s.end}
                className={({ isActive }) => `adm-nav__item${isActive ? ' is-active' : ''}`}
                title={s.label}
              >
                <NavIcon name={s.icon} size={19} />
                <span className="adm-nav__label">{s.label}</span>
                <span className="adm-nav__short">{s.short}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="adm-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
