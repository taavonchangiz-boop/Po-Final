import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';

/**
 * Generic paged-list hook (task 4-d-1).
 *
 * Wraps GET list endpoints that accept `?page&limit` and answer
 * `{ items, total, page, limit }` (contract §Pagination). Keeps the current
 * page, derives total pages, keeps previous data visible while the next page
 * loads (placeholderData) and resets to page 1 whenever `resetKey` changes
 * (filters/search identity).
 */

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface UsePagedOptions {
  /** Query-key prefix — include every filter value so caching stays correct. */
  queryKey: readonly unknown[];
  /** Builds the request path for a given (page, limit). */
  buildPath: (page: number, limit: number) => string;
  /** Page size (default 20, contract max 100). */
  limit?: number;
  /** Set false to hold the query (e.g. invalid id params). */
  enabled?: boolean;
}

const EMPTY_ITEMS: never[] = [];

export function usePaged<T>({ queryKey, buildPath, limit = 20, enabled = true }: UsePagedOptions) {
  const [page, setPage] = useState(1);

  // Reset to the first page when the filter identity changes (not on every
  // render — the stringified key is a stable dependency).
  const resetKey = JSON.stringify(queryKey);
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey;
      setPage(1);
    }
  }, [resetKey]);

  const query = useQuery({
    queryKey: [...queryKey, 'page', page, 'limit', limit],
    queryFn: () => get<PagedResult<T>>(buildPath(page, limit)),
    placeholderData: keepPreviousData,
    enabled,
  });

  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    ...query,
    items: query.data?.items ?? EMPTY_ITEMS,
    total,
    totalPages,
    page,
    setPage,
    limit,
  };
}
