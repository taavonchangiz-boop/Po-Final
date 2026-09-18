import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client.
 * - staleTime 15s: dashboard-ish data stays fresh without hammering the API.
 * - retry 1: single automatic retry for transient failures.
 * - refetchOnWindowFocus false: predictable behaviour for RTL content flows.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
