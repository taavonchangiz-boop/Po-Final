import { lazy, Suspense } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { RequireAuth, RequireRole } from './guards';
import { FullPageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { Compass } from 'lucide-react';

/* Route-level code splitting (PRODUCT-SPEC §5: performance / code-split frontend). */
const LandingPage = lazy(() => import('../features/landing/LandingPage'));
const AppLayout = lazy(() => import('./AppLayout'));

const OverviewPage = lazy(() => import('../features/dashboard/OverviewPage'));
const ChannelsPage = lazy(() => import('../features/channels/ChannelsPage'));
const PublishingPage = lazy(() => import('../features/publishing/PublishingPage'));
const SchedulingPage = lazy(() => import('../features/publishing/SchedulingPage'));
const BotsPage = lazy(() => import('../features/bots/BotsPage'));
const BotDetailPage = lazy(() => import('../features/bots/BotDetailPage'));
const WorkflowsPage = lazy(() => import('../features/workflows/WorkflowsPage'));
const AiPage = lazy(() => import('../features/ai/AiPage'));
const WooPage = lazy(() => import('../features/woocommerce/WooPage'));
const GoldPage = lazy(() => import('../features/gold/GoldPage'));
const AnalyticsPage = lazy(() => import('../features/analytics/AnalyticsPage'));
const SubscriptionPage = lazy(() => import('../features/billing/SubscriptionPage'));
const WalletPage = lazy(() => import('../features/billing/WalletPage'));
const ReferralsPage = lazy(() => import('../features/billing/ReferralsPage'));
const NotificationsPage = lazy(() => import('../features/notifications/NotificationsPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));
const SupportPage = lazy(() => import('../features/support/SupportPage'));
const AdminPage = lazy(() => import('../features/admin/AdminPage'));
const AdminUsersPage = lazy(() => import('../features/admin/AdminUsersPage'));
const AdminTicketsPage = lazy(() => import('../features/admin/AdminTicketsPage'));
const AdminPlansPage = lazy(() => import('../features/admin/AdminPlansPage'));
const AdminAuditPage = lazy(() => import('../features/admin/AdminAuditPage'));

function NotFoundPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState
        icon={Compass}
        title="صفحه‌ای که دنبالش بودید پیدا نشد"
        description="ممکن است نشانی را اشتباه وارد کرده باشید یا این صفحه جابه‌جا شده باشد."
        action={
          <Link
            to="/"
            className="focus-ring inline-flex h-10 items-center rounded-xl bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"
          >
            بازگشت به صفحهٔ اصلی
          </Link>
        }
      />
    </div>
  );
}

export default function AppRouter() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />

        {/* Authenticated app */}
        <Route element={<RequireAuth />}>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="channels" element={<ChannelsPage />} />
            <Route path="publishing" element={<PublishingPage />} />
            <Route path="scheduling" element={<SchedulingPage />} />
            <Route path="bots" element={<BotsPage />} />
            <Route path="bots/:id" element={<BotDetailPage />} />
            <Route path="workflows" element={<WorkflowsPage />} />
            <Route path="ai" element={<AiPage />} />
            <Route path="woocommerce" element={<WooPage />} />
            <Route path="gold" element={<GoldPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="subscription" element={<SubscriptionPage />} />
            <Route path="wallet" element={<WalletPage />} />
            <Route path="referrals" element={<ReferralsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="support" element={<SupportPage />} />
            {/* Admin (role-guarded) */}
            <Route element={<RequireRole roles={['ADMIN', 'SUPER_ADMIN']} />}>
              <Route path="admin" element={<AdminPage />} />
              <Route path="admin/users" element={<AdminUsersPage />} />
              <Route path="admin/tickets" element={<AdminTicketsPage />} />
              <Route path="admin/plans" element={<AdminPlansPage />} />
              <Route path="admin/audit" element={<AdminAuditPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
