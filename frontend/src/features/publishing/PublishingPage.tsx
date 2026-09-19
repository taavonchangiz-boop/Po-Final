import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Ban, CalendarClock, Eye, RefreshCw, Send } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { Dialog } from '../../components/ui/Dialog';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { get, post, del } from '../../lib/api';
import {
  faDate,
  labelOf,
  postStatusLabels,
  providerLabels,
  stateLabels,
  toFa,
} from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { JalaliPicker } from './JalaliPicker';
import {
  ErrorCard,
  errorMessage,
  planLimitMessage,
  recurrenceLabels,
  type ChannelLite,
  type PostDetail,
  type PostRecord,
} from './parts';

/**
 * Publishing (task 4-d-1) — composer + posts outbox.
 * Backend shapes verified against app/src/modules/publishing/publishing.routes.ts:
 *  - POST /posts { title?, body, channelIds:number[], scheduleAt?: ISO(offset), recurrence? }.
 *  - GET /posts/:id → { post, deliveries[] } (delivery rows carry joined channel).
 *  - POST /deliveries/:id/retry, POST /posts/:id/publish-now, DELETE /posts/:id.
 */

const BODY_MAX = 5000;

const STATUS_FILTERS = [
  { key: 'ALL', label: 'همه' },
  { key: 'DRAFT', label: 'پیش‌نویس' },
  { key: 'SCHEDULED', label: 'زمان‌بندی‌شده' },
  { key: 'PUBLISHED', label: 'منتشرشده' },
  { key: 'FAILED', label: 'ناموفق' },
] as const;

type Mode = 'now' | 'scheduled';

interface CreatePostResponse {
  postId?: number;
  status?: string;
  deliveries?: number;
  scheduled?: boolean;
}

export default function PublishingPage() {
  usePageTitle('انتشار');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  /* ------------------------------- composer ------------------------------- */

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('now');
  const [scheduleIso, setScheduleIso] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState('ONCE');
  const [formError, setFormError] = useState('');

  const activeChannels = useQuery({
    queryKey: ['channels', 'active-composer'],
    queryFn: () => get<{ items: ChannelLite[] }>('/channels?status=ACTIVE&limit=100'),
    select: (d) => (Array.isArray(d.items) ? d.items.filter((c) => c.status === 'ACTIVE') : []),
  });

  const channels: ChannelLite[] = activeChannels.data ?? [];

  function toggleChannel(id: number | string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const invalidatePosts = () => {
    void queryClient.invalidateQueries({ queryKey: ['posts'] });
    void queryClient.invalidateQueries({ queryKey: ['schedules'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => post<CreatePostResponse>('/posts', payload),
    onSuccess: () => {
      pushToast('success', 'پست با موفقیت ایجاد شد');
      setTitle('');
      setBody('');
      setSelectedIds(new Set());
      setMode('now');
      setScheduleIso(null);
      setRecurrence('ONCE');
      setFormError('');
      invalidatePosts();
    },
    onError: (e: unknown) => {
      const pl = planLimitMessage(e);
      if (pl) pushToast('error', pl);
      else pushToast('error', errorMessage(e));
    },
  });

  function submit() {
    if (body.trim().length === 0) {
      setFormError('متن پست الزامی است.');
      return;
    }
    if (selectedIds.size === 0) {
      setFormError('حداقل یک کانال مقصد انتخاب کنید.');
      return;
    }
    if (mode === 'scheduled' && !scheduleIso) {
      setFormError('زمان انتشار را انتخاب کنید.');
      return;
    }
    setFormError('');
    const payload: Record<string, unknown> = {
      body: body.trim(),
      channelIds: [...selectedIds].map(Number),
    };
    if (title.trim()) payload.title = title.trim();
    if (mode === 'scheduled' && scheduleIso) {
      payload.scheduleAt = scheduleIso;
      payload.recurrence = recurrence;
    }
    createMutation.mutate(payload);
  }

  /* ------------------------------ posts table ------------------------------ */

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [detailId, setDetailId] = useState<number | string | null>(null);
  const [cancelId, setCancelId] = useState<number | string | null>(null);

  const posts = usePaged<PostRecord>({
    queryKey: ['posts', statusFilter],
    buildPath: (page, limit) => {
      const base = `/posts?page=${page}&limit=${limit}`;
      return statusFilter === 'ALL' ? base : `${base}&status=${statusFilter}`;
    },
  });

  const detail = useQuery({
    queryKey: ['post', String(detailId)],
    queryFn: () => get<PostDetail>(`/posts/${detailId}`),
    enabled: detailId !== null,
  });

  const retryMutation = useMutation({
    mutationFn: (deliveryId: number | string) =>
      post<{ deliveryId: number; state: string }>(`/deliveries/${deliveryId}/retry`),
    onSuccess: () => {
      pushToast('success', 'ارسال مجدد در صف قرار گرفت.');
      if (detailId !== null) {
        void queryClient.invalidateQueries({ queryKey: ['post', String(detailId)] });
      }
      invalidatePosts();
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const publishNowMutation = useMutation({
    mutationFn: (postId: number | string) =>
      post<{ postId: number; enqueued: number }>(`/posts/${postId}/publish-now`, {}),
    onSuccess: (data) => {
      pushToast('success', `انتشار مجدد برای ${toFa(data?.enqueued ?? 0)} کانال در صف قرار گرفت.`);
      if (detailId !== null) {
        void queryClient.invalidateQueries({ queryKey: ['post', String(detailId)] });
      }
      invalidatePosts();
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const cancelMutation = useMutation({
    mutationFn: (postId: number | string) => del(`/posts/${postId}`),
    onSuccess: () => {
      pushToast('success', 'پست لغو شد.');
      setCancelId(null);
      setDetailId(null);
      invalidatePosts();
    },
    onError: (e: unknown) => {
      pushToast('error', errorMessage(e));
      setCancelId(null);
    },
  });

  const detailPost = detail.data?.post ?? null;
  const detailDeliveries = useMemo(
    () => (Array.isArray(detail.data?.deliveries) ? detail.data?.deliveries ?? [] : []),
    [detail.data],
  );

  const canPublishNow = detailPost
    ? detailPost.status === 'FAILED' || detailPost.status === 'PARTIAL'
    : false;
  const canCancel = detailPost?.status === 'SCHEDULED';

  const isLoadingPosts = posts.isLoading;

  return (
    <>
      <PageHeader
        title="انتشار"
        description="ساخت پست و انتشار هم‌زمان در کانال‌های منتخب"
      />

      <div className="space-y-6">
        {/* ------------------------------- composer ------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle>پست جدید</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {activeChannels.error ? (
              <ErrorCard
                message={errorMessage(activeChannels.error)}
                onRetry={() => void activeChannels.refetch()}
              />
            ) : null}

            <Input
              label="عنوان (اختیاری)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="برای مدیریت بهتر پست‌ها یک عنوان بنویسید"
            />

            <div>
              <Textarea
                label="متن پست"
                rows={6}
                required
                value={body}
                maxLength={BODY_MAX}
                onChange={(e) => setBody(e.target.value)}
                placeholder="متن پیام خود را بنویسید…"
                aria-describedby="body-counter"
              />
              <p id="body-counter" className="mt-1 text-xs text-neutral-400" dir="ltr">
                {toFa(body.length)} / {toFa(BODY_MAX)}
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-neutral-700">
                کانال‌های مقصد <span className="text-red-600">*</span>
              </p>
              {activeChannels.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }, (_, i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : channels.length === 0 ? (
                <p className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
                  کانال فعالی ندارید.{' '}
                  <Link to="/app/channels" className="font-medium text-primary-700 underline-offset-4 hover:underline">
                    افزودن کانال
                  </Link>
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {channels.map((ch) => {
                    const key = String(ch.id);
                    const checked = selectedIds.has(key);
                    return (
                      <li key={key}>
                        <label
                          className={
                            'focus-within:ring-primary-600 flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition-colors ' +
                            (checked
                              ? 'border-primary-600 bg-primary-50 text-primary-900'
                              : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300')
                          }
                        >
                          <input
                            type="checkbox"
                            className="accent-primary-700 size-4"
                            checked={checked}
                            onChange={() => toggleChannel(ch.id)}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">{ch.title || '—'}</span>
                          <Badge tone="neutral">{labelOf(providerLabels, ch.provider)}</Badge>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <div
                role="radiogroup"
                aria-label="حالت انتشار"
                className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-neutral-100 p-1"
              >
                {(
                  [
                    { key: 'now', label: 'انتشار فوری', icon: Send },
                    { key: 'scheduled', label: 'زمان‌بندی', icon: CalendarClock },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const active = mode === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setMode(opt.key)}
                      className={
                        'focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ' +
                        (active
                          ? 'bg-white text-primary-800 shadow-sm'
                          : 'text-neutral-600 hover:text-neutral-900')
                      }
                    >
                      <Icon aria-hidden="true" className="size-4" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {mode === 'scheduled' ? (
              <div className="space-y-3">
                <JalaliPicker value={scheduleIso} onChange={setScheduleIso} />
                <Select
                  label="تکرار"
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value)}
                  hint="تکرار زمان‌بندی؛ «یک‌بار» پس از اجرا پایان می‌یابد."
                >
                  {Object.entries(recurrenceLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            {formError ? (
              <p role="alert" className="text-sm text-red-600">
                {formError}
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button onClick={submit} loading={createMutation.isPending}>
                <Send aria-hidden="true" className="size-4" />
                {mode === 'now' ? 'انتشار فوری' : 'ثبت زمان‌بندی'}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* ------------------------------ posts list ------------------------------ */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="فیلتر وضعیت پست‌ها">
            {STATUS_FILTERS.map((f) => {
              const active = statusFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(f.key)}
                  className={
                    'focus-ring inline-flex h-8 items-center rounded-full border px-3.5 text-xs font-medium transition-colors ' +
                    (active
                      ? 'border-primary-700 bg-primary-700 text-white'
                      : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900')
                  }
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {isLoadingPosts ? (
            <Card>
              <CardBody className="space-y-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </CardBody>
            </Card>
          ) : posts.error ? (
            <ErrorCard message={errorMessage(posts.error)} onRetry={() => void posts.refetch()} />
          ) : posts.items.length === 0 ? (
            <EmptyState
              icon={Send}
              title="هنوز پستی ساخته نشده"
              description="اولین پست خود را از فرم بالا بنویسید و در کانال‌های منتخب منتشر کنید؛ وضعیت ارسالِ هر کانال جداگانه قابل پیگیری است."
            />
          ) : (
            <>
              <Table caption="فهرست پست‌ها">
                <THead>
                  <TR>
                    <TH>عنوان</TH>
                    <TH>وضعیت</TH>
                    <TH>ایجاد</TH>
                    <TH>عملیات</TH>
                  </TR>
                </THead>
                <TBody>
                  {posts.items.map((p) => (
                    <TR key={String(p.id)}>
                      <TD className="max-w-72 font-medium text-neutral-900">
                        <span className="block truncate">{p.title || 'بدون عنوان'}</span>
                        {p.title ? (
                          <span className="mt-0.5 block truncate text-xs font-normal text-neutral-400">
                            {p.body}
                          </span>
                        ) : null}
                      </TD>
                      <TD>
                        <Badge state={p.status} labels={postStatusLabels} />
                      </TD>
                      <TD className="text-xs text-neutral-500">{faDate(p.createdAt) || '—'}</TD>
                      <TD>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setDetailId(p.id)}
                        >
                          <Eye aria-hidden="true" className="size-4" />
                          جزئیات ارسال
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination page={posts.page} totalPages={posts.totalPages} onChange={posts.setPage} />
            </>
          )}
        </section>
      </div>

      {/* ---------------------------- detail dialog ----------------------------- */}
      <Dialog
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        title="وضعیت ارسال پست"
        description={
          detailPost?.title || (detailPost?.body ? detailPost.body.slice(0, 60) : undefined)
        }
        size="lg"
        footer={
          <>
            {canPublishNow ? (
              <Button
                variant="secondary"
                loading={publishNowMutation.isPending}
                disabled={publishNowMutation.isPending || detailId === null}
                onClick={() => detailId !== null && publishNowMutation.mutate(detailId)}
              >
                <RefreshCw aria-hidden="true" className="size-4" />
                انتشار مجدد
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                variant="ghost"
                className="text-red-600"
                disabled={cancelMutation.isPending}
                onClick={() => detailId !== null && setCancelId(detailId)}
              >
                <Ban aria-hidden="true" className="size-4" />
                لغو پست زمان‌بندی‌شده
              </Button>
            ) : null}
          </>
        }
      >
        {detail.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : detail.error ? (
          <ErrorCard message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
        ) : detailDeliveries.length === 0 ? (
          <p className="text-sm text-neutral-500">برای این پست ارسالی ثبت نشده است.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {detailDeliveries.map((d) => (
              <li key={String(d.id)} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                    <span className="truncate">{d.channel?.title || '—'}</span>
                    <Badge tone="neutral">{labelOf(providerLabels, d.channel?.provider)}</Badge>
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    تلاش {toFa(d.attempts ?? 0)} از {toFa(d.maxAttempts ?? 0)}
                    {d.sentAt ? ` — ارسال در ${faDate(d.sentAt)}` : ''}
                  </p>
                  {d.lastError ? (
                    <p className="mt-1 max-w-md text-xs text-red-600">{d.lastError}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge state={d.state} labels={stateLabels} />
                  {d.state === 'FAILED' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={retryMutation.isPending && retryMutation.variables === d.id}
                      disabled={retryMutation.isPending}
                      onClick={() => retryMutation.mutate(d.id)}
                    >
                      تلاش مجدد
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      {/* ----------------------------- cancel confirm ---------------------------- */}
      <ConfirmDialog
        open={cancelId !== null}
        onClose={() => setCancelId(null)}
        onConfirm={() => {
          if (cancelId !== null) cancelMutation.mutate(cancelId);
        }}
        loading={cancelMutation.isPending}
        title="لغو پست"
        description="با لغو پست، ارسال‌های در انتظار آن لغو می‌شود. این عمل بازگشت‌پذیر نیست."
        confirmLabel="بله، لغو کن"
      />
    </>
  );
}
