import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { get, post } from '../../lib/api';
import { faDateTime, faNumber, labelOf } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { errorMessage, ErrorCard } from '../publishing/parts';

/**
 * Notifications — list with unread filter, mark-read and read-all.
 * Shape verified against app/src/modules/notifications/notifications.routes.ts +
 * db/schema.ts:
 *  - GET /notifications?page&limit&unread=true|false → { items, total, page, limit,
 *    unreadCount } — item: { id, userId, category: SYSTEM|BILLING|PUBLISHING|
 *    SECURITY|SUBSCRIPTION, title, body, data, readAt, createdAt }.
 *  - POST /notifications/:id/read → { ok: true }.
 *  - POST /notifications/read-all → { ok: true, updated }.
 */

interface NotificationRecord {
  id: number | string;
  category?: string;
  title?: string;
  body?: string;
  readAt?: string | null;
  createdAt?: string;
}

interface NotificationsResponse {
  items?: NotificationRecord[];
  total?: number;
  page?: number;
  limit?: number;
  unreadCount?: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  SYSTEM: 'سیستمی',
  BILLING: 'مالی',
  PUBLISHING: 'انتشار',
  SECURITY: 'امنیت',
  SUBSCRIPTION: 'اشتراک',
};

const CATEGORY_TONES: Record<string, 'info' | 'success' | 'danger' | 'neutral' | 'warning'> = {
  SYSTEM: 'neutral',
  BILLING: 'success',
  PUBLISHING: 'info',
  SECURITY: 'danger',
  SUBSCRIPTION: 'warning',
};

const PAGE_SIZE = 15;

export default function NotificationsPage() {
  usePageTitle('اعلان‌ها');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ['notifications', unreadOnly ? 'unread' : 'all', page],
    placeholderData: (prev) => prev,
    queryFn: () =>
      get<NotificationsResponse>(
        `/notifications?page=${page}&limit=${PAGE_SIZE}&unread=${unreadOnly ? 'true' : 'false'}`,
      ),
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'overview'] });
  };

  const markReadMutation = useMutation({
    mutationFn: (id: number | string) => post(`/notifications/${id}/read`),
    onMutate: (id) => {
      // Optimistic local read so the dot disappears instantly.
      queryClient.setQueryData<NotificationsResponse>(
        ['notifications', unreadOnly ? 'unread' : 'all', page],
        (old) =>
          old
            ? {
                ...old,
                items: (old.items ?? []).map((n) =>
                  String(n.id) === String(id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n,
                ),
              }
            : old,
      );
    },
    onSettled: () => invalidate(),
    onError: () => pushToast('error', 'ثبت خوانده‌شدن اعلان ناموفق بود.'),
  });

  const readAllMutation = useMutation({
    mutationFn: () => post<{ updated?: number }>('/notifications/read-all'),
    onSuccess: (data) => {
      pushToast('success', `${faNumber(data?.updated ?? 0)} اعلان خوانده‌نشده علامت‌گذاری شد.`);
      invalidate();
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const unreadCount = list.data?.unreadCount ?? 0;

  return (
    <>
      <PageHeader
        title="اعلان‌ها"
        description="رویدادهای حساب، پرداخت و انتشار"
        actions={
          <Button
            variant="secondary"
            loading={readAllMutation.isPending}
            disabled={readAllMutation.isPending || unreadCount === 0}
            onClick={() => readAllMutation.mutate()}
          >
            <CheckCheck aria-hidden="true" className="size-4" />
            خواندن همه
          </Button>
        }
      />

      <div className="space-y-4">
        <Tabs
          ariaLabel="فیلتر اعلان‌ها"
          items={[
            { key: 'all', label: 'همه' },
            { key: 'unread', label: `خوانده‌نشده (${faNumber(unreadCount)})` },
          ]}
          active={unreadOnly ? 'unread' : 'all'}
          onChange={(key) => {
            setUnreadOnly(key === 'unread');
            setPage(1);
          }}
        />

        {list.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Card key={i}>
                <CardBody className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full" />
                </CardBody>
              </Card>
            ))}
          </div>
        ) : list.error ? (
          <ErrorCard message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={unreadOnly ? 'اعلان خوانده‌نشده‌ای ندارید' : 'هنوز اعلانی دریافت نکرده‌اید'}
            description={
              unreadOnly
                ? 'همهٔ اعلان‌ها خوانده شده‌اند.'
                : 'اعلان‌های پرداخت، انتشار و سیستم اینجا نمایش داده می‌شوند.'
            }
          />
        ) : (
          <>
            <ul className="space-y-2">
              {items.map((item) => {
                const isUnread = !item.readAt;
                return (
                  <li key={String(item.id)}>
                    <button
                      type="button"
                      onClick={() => {
                        if (isUnread) markReadMutation.mutate(item.id);
                      }}
                      className={
                        'focus-ring w-full rounded-card border bg-white p-4 text-start shadow-sm transition-colors hover:border-primary-300 ' +
                        (isUnread ? 'border-primary-200' : 'border-neutral-200')
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            aria-hidden="true"
                            className={
                              'mt-1.5 size-2 shrink-0 rounded-full ' + (isUnread ? 'bg-primary-600' : 'bg-transparent')
                            }
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={CATEGORY_TONES[item.category ?? ''] ?? 'neutral'}>
                                {labelOf(CATEGORY_LABELS, item.category)}
                              </Badge>
                              <p className="truncate text-sm font-semibold text-neutral-900">{item.title || '—'}</p>
                            </div>
                            <p className="mt-1.5 text-sm leading-6 text-neutral-600">{item.body || ''}</p>
                          </div>
                        </div>
                        <time className="shrink-0 text-xs text-neutral-400" dateTime={item.createdAt}>
                          {faDateTime(item.createdAt)}
                        </time>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </div>
    </>
  );
}
