import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { get, ApiError } from '../lib/api';
import type { MeResponse, Role } from '../lib/types';
import { usePageTitle } from './usePageTitle';
import { FullPageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { ShieldOff } from 'lucide-react';

/** Query key for the current-user session. Invalidate after login/logout. */
export const ME_QUERY_KEY = ['me'] as const;

/** GET /me — session user + tenant summary. Never retries on 401. */
export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => get<MeResponse>('/me'),
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 401) && failureCount < 1,
  });
}

/**
 * Auth guard: blocks /app until /me succeeds. On a definitive 401 the api layer
 * dispatches 'postyar:unauthorized' (auth modal opens) and we redirect to the
 * public landing page.
 */
export function RequireAuth() {
  const { data, isLoading, error } = useMe();
  const navigate = useNavigate();

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      navigate('/', { replace: true });
    }
  }, [error, navigate]);

  if (isLoading) return <FullPageSpinner />;
  if (error || !data) {
    // Give the redirect above (and the auth-modal flow) a beat; render nothing
    // meaningful — an unauthenticated user must never see app content.
    return <FullPageSpinner />;
  }
  return <Outlet />;
}

/** Role guard for admin surfaces (SUPER_ADMIN / ADMIN). */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { data } = useMe();
  const role = data?.user.role;
  if (!role) return null; // parent RequireAuth guarantees data
  if (!roles.includes(role)) return <ForbiddenPage />;
  return <Outlet />;
}

function ForbiddenPage() {
  usePageTitle('دسترسی غیرمجاز');
  return (
    <EmptyState
      icon={ShieldOff}
      title="دسترسی غیرمجاز"
      description="شما اجازهٔ دسترسی به بخش مدیریت را ندارید. در صورت نیاز با مدیر ارشد سامانه تماس بگیرید."
    />
  );
}

/** Convenience redirect for '/app' parents that must not render. */
export function RedirectToApp() {
  return <Navigate to="/app" replace />;
}
