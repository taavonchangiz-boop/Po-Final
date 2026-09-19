import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { BarChart3, Info, Send } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton, SkeletonText } from '../../components/ui/Skeleton';
import DailyActivityChart from './DailyActivityChart';
import { usePageTitle } from '../../app/usePageTitle';
import { get } from '../../lib/api';
import { faNumber, faPercent, faDateTime, toFa } from '../../lib/format';
import { errorMessage, ErrorCard } from '../publishing/parts';
import { eventLabels, faDayLabel } from './analyticsParts';

/**
 * Analytics — publishing series, per-domain reports and the cursor-paginated
 * activity timeline. Shapes verified against app/src/modules/analytics/:
 *  - GET /analytics/publishing?days → { series: [{ date, sent, failed }] }
 *  - GET /analytics/channels?days → { items: [{ channelId, title, sent, failed }] }
 *  - GET /analytics/bots?days → { items: [{ botId, received, sent }] } (no title —
 *    bot names are joined client-side from GET /bots)
 *  - GET /analytics/ai?days → { series: [{ date, credits }] }
 *  - GET /analytics/overview?days → KPIs (same shape as the overview page)
 *  - GET /analytics/timeline?cursor&limit → { items: [{ id, type, subjectType,
 *    subjectId, data, createdAt }], nextCursor }
 */

interface SeriesPoint {
  date?: string;
  sent?: number;
  failed?: number;
  credits?: number;
}

interface ChannelReportRow {
  channelId?: number;
  title?: string | null;
  sent?: number;
  failed?: number;
}

interface BotReportRow {
  botId?: number;
  received?: number;
  sent?: number;
}

interface BotLite {
  id: number | string;
  title?: string;
}

interface TimelineItem {
  id: number | string;
  type?: string;
  subjectType?: string | null;
  subjectId?: number | null;
  data?: Record<string, unknown> | null;
  createdAt?: string;
}

interface OverviewResponse {
  postsSent?: number;
  deliveryFailed?: number;
  successRate?: number | null;
  botMessages?: number;
  aiCredits?: { used?: number; quota?: number; month?: string };
  activeChannels?: number;
}

const RANGES = [
  { days: 7, label: '۷ روزه' },
  { days: 14, label: '۱۴ روزه' },
  { days: 30, label: '۳۰ روزه' },
] as const;

const TIMELINE_PAGE_SIZE = 20;

function timelineLabel(item: TimelineItem): string {
  const raw = item.type ?? '';
  return eventLabels[raw] ?? raw;
}

export default function AnalyticsPage() {
  usePageTitle('گزارش‌ها');
  const [days, setDays] = useState<number>(14);

  /* ------------------------------- publishing chart ------------------------------ */
  const publishing = useQuery({
    queryKey: ['analytics', 'publishing', days],
    queryFn: () => get<{ series?: SeriesPoint[] }>(`/analytics/publishing?days=${days}`),
  });

  // Rendered RTL (newest on the LEFT) by DailyActivityChart — item 12.

  /* ----------------------------------- KPIs ----------------------------------- */
  const overview = useQuery({
    queryKey: ['analytics', 'overview', days],
    queryFn: () => get<OverviewResponse>(`/analytics/overview?days=${days}`),
  });

  /* --------------------------------- reports ---------------------------------- */
  const channelsReport = useQuery({
    queryKey: ['analytics', 'channels', days],
    queryFn: () => get<{ items?: ChannelReportRow[] }>(`/analytics/channels?days=${days}`),
  });

  const botsReport = useQuery({
    queryKey: ['analytics', 'bots', days],
    queryFn: () => get<{ items?: BotReportRow[] }>(`/analytics/bots?days=${days}`),
  });

  const botsLite = useQuery({
    queryKey: ['analytics', 'botNames'],
    queryFn: () => get<{ items?: BotLite[] }>('/bots?page=1&limit=100'),
  });
  const botNameById = new Map<string, string>();
  for (const bot of botsLite.data?.items ?? []) {
    botNameById.set(String(bot.id), bot.title ?? `ربات #${toFa(String(bot.id))}`);
  }

  const aiSeries = useQuery({
    queryKey: ['analytics', 'ai', days],
    queryFn: () => get<{ series?: SeriesPoint[] }>(`/analytics/ai?days=${days}`),
  });

  /* ----------------------------- timeline (cursor) ----------------------------- */
  const timeline = useInfiniteQuery({
    queryKey: ['analytics', 'timeline', 'page'],
    queryFn: ({ pageParam }) =>
      get<{ items?: TimelineItem[]; nextCursor?: number | null }>(
        `/analytics/timeline?limit=${TIMELINE_PAGE_SIZE}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const timelineItems: TimelineItem[] = (timeline.data?.pages ?? []).flatMap((page) => page.items ?? []);

  return (
    <>
      <PageHeader
        title="گزارش‌ها"
        description="آمار ارسال‌ها، ربات‌ها و مصرف هوش مصنوعی"
        actions={
          <div className="flex items-center gap-1 rounded-xl bg-neutral-100 p-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setDays(r.days)}
                aria-pressed={days === r.days}
                className={
                  'focus-ring rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ' +
                  (days === r.days ? 'bg-white text-primary-800 shadow-sm' : 'text-neutral-600 hover:text-neutral-900')
                }
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="space-y-6">
        {/* KPI row */}
        {overview.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Card key={i} className="p-5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-7 w-20" />
              </Card>
            ))}
          </div>
        ) : overview.error ? (
          <ErrorCard message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="ارسال‌های موفق" value={faNumber(overview.data?.postsSent ?? 0)} icon={Send} />
            <Stat
              label="نرخ موفقیت"
              value={
                overview.data?.successRate === null || overview.data?.successRate === undefined
                  ? '—'
                  : faPercent((overview.data.successRate ?? 0) * 100)
              }
              icon={BarChart3}
            />
            <Stat label="پیام‌های ربات" value={faNumber(overview.data?.botMessages ?? 0)} icon={Send} />
            <Stat
              label="اعتبار هوش مصنوعی مصرفی"
              value={faNumber(overview.data?.aiCredits?.used ?? 0)}
              icon={BarChart3}
              hint={`سهمیه ماه: ${faNumber(overview.data?.aiCredits?.quota ?? 0)}`}
            />
          </div>
        )}

        {/* Publishing series */}
        <Card>
          <CardHeader>
            <CardTitle>روند روزانهٔ ارسال</CardTitle>
          </CardHeader>
          <CardBody>
            {publishing.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : publishing.error ? (
              <ErrorCard message={errorMessage(publishing.error)} onRetry={() => void publishing.refetch()} />
            ) : (publishing.data?.series ?? []).length === 0 ? (
              <EmptyState
                title="ارسالی در این بازه ثبت نشده است"
                description="پس از اولین انتشار، روند روزانهٔ ارسال‌ها اینجا نمایش داده می‌شود."
              />
            ) : (
              <DailyActivityChart
                series={publishing.data?.series ?? []}
                ariaLabel="نمودار ستونی فعالیت روزانهٔ ارسال، موفق و ناموفق، با محور زمانی راست‌به‌چپ"
              />
            )}
          </CardBody>
        </Card>

        {/* Channels + bots reports */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>عملکرد کانال‌ها</CardTitle>
            </CardHeader>
            <CardBody>
              {channelsReport.isLoading ? (
                <SkeletonText lines={4} />
              ) : channelsReport.error ? (
                <ErrorCard message={errorMessage(channelsReport.error)} onRetry={() => void channelsReport.refetch()} />
              ) : (channelsReport.data?.items ?? []).length === 0 ? (
                <EmptyState title="داده‌ای برای این بازه ثبت نشده است" description="پس از انتشار پست در کانال‌ها، عملکرد هر کانال اینجا گزارش می‌شود." />
              ) : (
                <Table caption="گزارش ارسال به تفکیک کانال">
                  <THead>
                    <TR>
                      <TH>کانال</TH>
                      <TH>موفق</TH>
                      <TH>ناموفق</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {(channelsReport.data?.items ?? []).map((row) => (
                      <TR key={String(row.channelId)}>
                        <TD className="font-medium text-neutral-900">{row.title || `کانال #${toFa(String(row.channelId ?? ''))}`}</TD>
                        <TD>{faNumber(row.sent ?? 0)}</TD>
                        <TD>{faNumber(row.failed ?? 0)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>عملکرد ربات‌ها</CardTitle>
            </CardHeader>
            <CardBody>
              {botsReport.isLoading || botsLite.isLoading ? (
                <SkeletonText lines={4} />
              ) : botsReport.error ? (
                <ErrorCard message={errorMessage(botsReport.error)} onRetry={() => void botsReport.refetch()} />
              ) : (botsReport.data?.items ?? []).length === 0 ? (
                <EmptyState title="داده‌ای برای این بازه ثبت نشده است" description="پس از تبادل اولین پیام ربات با کاربران، آمار اینجا نمایش داده می‌شود." />
              ) : (
                <Table caption="گزارش پیام‌های ربات">
                  <THead>
                    <TR>
                      <TH>ربات</TH>
                      <TH>دریافتی</TH>
                      <TH>ارسالی</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {(botsReport.data?.items ?? []).map((row) => (
                      <TR key={String(row.botId)}>
                        <TD className="font-medium text-neutral-900">
                          {botNameById.get(String(row.botId)) ?? `ربات #${toFa(String(row.botId ?? ''))}`}
                        </TD>
                        <TD>{faNumber(row.received ?? 0)}</TD>
                        <TD>{faNumber(row.sent ?? 0)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>

        {/* AI credits per day */}
        <Card>
          <CardHeader>
            <CardTitle>مصرف روزانهٔ اعتبار هوش مصنوعی</CardTitle>
          </CardHeader>
          <CardBody>
            {aiSeries.isLoading ? (
              <SkeletonText lines={4} />
            ) : aiSeries.error ? (
              <ErrorCard message={errorMessage(aiSeries.error)} onRetry={() => void aiSeries.refetch()} />
            ) : (aiSeries.data?.series ?? []).length === 0 ? (
              <EmptyState title="مصرفی در این بازه ثبت نشده است" description="پس از اولین درخواست هوش مصنوعی، مصرف روزانه اینجا گزارش می‌شود." />
            ) : (
              <Table caption="مصرف روزانهٔ اعتبار هوش مصنوعی">
                <THead>
                  <TR>
                    <TH>روز</TH>
                    <TH>اعتبار مصرفی</TH>
                  </TR>
                </THead>
                <TBody>
                  {(aiSeries.data?.series ?? []).map((point) => (
                    <TR key={point.date}>
                      <TD>{point.date ? faDayLabel(point.date) : '—'}</TD>
                      <TD>{faNumber(point.credits ?? 0)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Timeline */}
        <Card>
          <CardHeader>
            <CardTitle>رخدادهای اخیر</CardTitle>
          </CardHeader>
          <CardBody>
            {timeline.isLoading ? (
              <SkeletonText lines={6} />
            ) : timeline.error ? (
              <ErrorCard message={errorMessage(timeline.error)} onRetry={() => void timeline.refetch()} />
            ) : timelineItems.length === 0 ? (
              <EmptyState title="رخدادی ثبت نشده است" description="فعالیت‌های حساب شما به‌ترتیب زمانی اینجا نمایش داده می‌شوند." />
            ) : (
              <div className="space-y-4">
                <ul className="divide-y divide-neutral-100">
                  {timelineItems.map((item) => (
                    <li key={String(item.id)} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-neutral-800">{timelineLabel(item)}</p>
                        {item.subjectType ? (
                          <p className="mt-0.5 text-xs text-neutral-400">
                            {item.subjectType === 'channel'
                              ? 'کانال'
                              : item.subjectType === 'post'
                                ? 'پست'
                                : item.subjectType === 'bot'
                                  ? 'ربات'
                                  : item.subjectType === 'ai_job'
                                    ? 'درخواست هوش مصنوعی'
                                    : item.subjectType === 'payment'
                                      ? 'پرداخت'
                                      : item.subjectType === 'ticket'
                                        ? 'تیکت'
                                        : item.subjectType === 'wordpress_site'
                                          ? 'سایت وردپرسی'
                                          : item.subjectType === 'gold_config'
                                            ? 'تنظیمات طلا'
                                            : item.subjectType}{' '}
                            #{toFa(String(item.subjectId ?? ''))}
                          </p>
                        ) : null}
                      </div>
                      <time className="shrink-0 text-xs text-neutral-400" dateTime={item.createdAt}>
                        {faDateTime(item.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
                {timeline.hasNextPage && (
                  <div className="flex justify-center">
                    <Button variant="secondary" loading={timeline.isFetchingNextPage} onClick={() => void timeline.fetchNextPage()}>
                      بیشتر
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Privacy note */}
        <p className="flex items-start gap-2 text-xs leading-6 text-neutral-400">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          محتوای خصوصی پیام‌ها در گزارش‌ها نمایش داده نمی‌شود؛ فقط آمار تعدادی رخدادها نگهداری می‌شود.
        </p>
      </div>
    </>
  );
}
