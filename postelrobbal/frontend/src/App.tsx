import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { LandingLayout, DashboardLayout } from './layouts/Layout';
import { PageLoading } from './components/ui';

// Route-level code splitting (§82)
const Landing = lazy(() => import('./pages/Landing'));
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'));
const Channels = lazy(() => import('./pages/dashboard/Channels'));
const Posts = lazy(() => import('./pages/dashboard/Posts'));
const PostNew = lazy(() => import('./pages/dashboard/PostNew'));
const PostDetail = lazy(() => import('./pages/dashboard/PostDetail'));
const Bots = lazy(() => import('./pages/dashboard/Bots'));
const BotDetail = lazy(() => import('./pages/dashboard/BotDetail'));
const Workflows = lazy(() => import('./pages/dashboard/Workflows'));
const WorkflowBuilder = lazy(() => import('./pages/dashboard/WorkflowBuilder'));
const Ai = lazy(() => import('./pages/dashboard/Ai'));
const WooCommerce = lazy(() => import('./pages/dashboard/WooCommerce'));
const Gold = lazy(() => import('./pages/dashboard/Gold'));
const Analytics = lazy(() => import('./pages/dashboard/Analytics'));
const Subscription = lazy(() => import('./pages/dashboard/Subscription'));
const Wallet = lazy(() => import('./pages/dashboard/Wallet'));
const Referrals = lazy(() => import('./pages/dashboard/Referrals'));
const Notifications = lazy(() => import('./pages/dashboard/Notifications'));
const Settings = lazy(() => import('./pages/dashboard/Settings'));
const Support = lazy(() => import('./pages/dashboard/Support'));
const Admin = lazy(() => import('./pages/dashboard/Admin'));
const PaymentResult = lazy(() => import('./pages/PaymentResult'));

export function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route element={<LandingLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/payment/result" element={<PaymentResult />} />
          <Route path="*" element={<Landing />} />
        </Route>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="channels" element={<Channels />} />
          <Route path="posts" element={<Posts />} />
          <Route path="posts/new" element={<PostNew />} />
          <Route path="posts/:id" element={<PostDetail />} />
          <Route path="bots" element={<Bots />} />
          <Route path="bots/:id" element={<BotDetail />} />
          <Route path="workflows" element={<Workflows />} />
          <Route path="workflows/new" element={<WorkflowBuilder />} />
          <Route path="ai" element={<Ai />} />
          <Route path="woocommerce" element={<WooCommerce />} />
          <Route path="gold" element={<Gold />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="subscription" element={<Subscription />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="referrals" element={<Referrals />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="settings" element={<Settings />} />
          <Route path="support" element={<Support />} />
          <Route path="admin" element={<Admin />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
