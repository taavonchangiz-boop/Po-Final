import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Card, EmptyState, PageLoading, StatCard } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { faCompact, faDateShort, faDigits, faMoney, faNumber, faRelative } from '../../lib/format';

interface OverviewDto {
  channels: { total: number; active: number };
  bots: { total: number; active: number };
  posts: { total: number; published: number };
  deliveries: { sent30d: number; failed30d: number };
  wallet: { balanceRial: number };
  ai: { periodYm: string; requestCount: number; tokenCount: number };
}

interface DailySeriesDto {
  days: number;
  series: Array<{ day: string; eventName: string; count: number }>;
}

interface EventRowDto {
  id: string;
  name: string;
  subjectType: string;
  subjectId: string;
  createdAt: string;
}

interface EventsDto {
  events: EventRowDto[];
  nextCursor: string | null;
}

const EVENT_FA: Record<string, string> = {
  'post.created': 'ایجاد پست',
  'post.scheduled': 'زمان‌بندی پست',
  'post.publish': 'انتشار پست',
  'post.sent': 'ارسال پست',
  'post.failed': 'شکست ارسال',
  'user.login': 'ورود به حساب',
  'user.logout': 'خروج از حساب',
  'user.registration': 'ثبت‌نام',
  'channel.created': 'افزودن کانال',
  'channel.connected': 'اتصال کانال',
  'channel.disconnected': 'قطع اتصال کانال',
  'channel.updated': 'ویرایش کانال',
  'bot.created': 'افزودن ربات',
  'bot.enabled': 'فعال‌سازی ربات',
  'bot.disabled': 'غیرفعال‌سازی ربات',
  'bot.message.received': 'پیام دریافتی ربات',
  'bot.message.sent': 'پیام ارسالی ربات',
  'payment.initiated': 'آغاز پرداخت',
  'payment.completed': 'پرداخت موفق',
  'payment.failed': 'پرداخت ناموفق',
  'subscription.created': 'خرید اشتراک',
  'subscription.expired': 'پایان اشتراک',
  'subscription.expiring': 'نزدیک به پایان اشتراک',
  'ai.requested': 'درخواست هوش مصنوعی',
  'ai.completed': 'تکمیل پردازش هوش مصنوعی',
  'ai.failed': 'شکست پردازش هوش مصنوعی',
  'workflow.started': 'آغاز گردش‌کار',
  'workflow.completed': 'تکمیل گردش‌کار',
  'workflow.failed': 'شکست گردش‌کار',
  'wordpress.connected': 'اتصال ووکامرس',
  'wordpress.disconnected': 'قطع اتصال ووکامرس',
  'wordpress.product.published': 'انتشار محصول در کانال',
  'gold.published': 'انتشار نرخ لحظه‌ای طلا',
  'referral.created': 'ایجاد زیرمجموعه',
  'referral.rewarded': 'پاداش زیرمجموعه‌گیری',
};

const EVENT_ICON: Record<string, string> = {
  'post.sent': '🚀',
  'post.failed': '⛔',
  'user.login': '🔑',
  'channel.created': '📻',
  'bot.message.received': '🤖',
  'payment.completed': '💳',
};

const DAYS_WINDOW = 14;

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

interface DayColumn {
  day: string;
  count: number;
}

export default function Analytics() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewDto | null>(null);
  const [columns, setColumns] = useState<DayColumn[]>([]);
  const [events, setEvents] = useState<EventRowDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [chartError, setChartError] = useState(false);
  const [eventsError, setEventsError] = useState(false);

  const loadEvents = useCallback(
    async (cursor?: string) => {
      setEventsLoading(true);
      try {
        const q = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=30` : '?limit=30';
        const data = await api.get<EventsDto>(`/api/v1/analytics/events${q}`);
        setEvents((prev) => (cursor ? [...prev, ...(data.events ?? [])] : data.events ?? []));
        setNextCursor(data.nextCursor ?? null);
        setEventsError(false);
      } catch (e) {
        setEventsError(true);
        toast.error(errText(e));
      } finally {
        setEventsLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      // Daily counts are per-eventName rows; aggregate client-side into one bar per day.
      const sinceMs = Date.now() - (DAYS_WINDOW - 1) * 24 * 3600 * 1000;
      const buckets = new Map<string, number>();
      for (let i = 0; i < DAYS_WINDOW; i++) {
        const d = new Date(sinceMs + i * 24 * 3600 * 1000);
        buckets.set(d.toISOString().slice(0, 10), 0);
      }
      try {
        const [ov, daily] = await Promise.all([
          api.get<OverviewDto>('/api/v1/analytics/overview'),
          api.get<DailySeriesDto>(`/api/v1/analytics/daily?days=${DAYS_WINDOW}`),
        ]);
        if (cancelled) return;
        setOverview(ov);
        for (const row of daily.series ?? []) {
          const key = String(row.day).slice(0, 10);
          if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + (row.count ?? 0));
        }
        setColumns(
          Array.from(buckets.entries())
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([day, count]) => ({ day, count }))
        );
        setChartError(false);
      } catch (e) {
        if (!cancelled) {
          setChartError(true);
          toast.error(errText(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
      void loadEvents();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !overview) return <PageLoading />;

  if (!overview && chartError) {
    return (
      <EmptyState
        icon="📊"
        title="آمار بارگذاری نشد"
        description="در دریافت اطلاعات تحلیلی مشکلی پیش آمد. لطفاً صفحه را دوباره بارگذاری کنید."
      />
    );
  }

  const maxCount = Math.max(1, ...columns.map((c) => c.count));

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>تحلیل آمار</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>نمای کلی عملکرد انتشار و رویدادهای حساب شما</p>
      </div>

      {overview && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))' }}>
          <StatCard icon="🚀" bg="#ecfdf5" value={faNumber(overview.deliveries.sent30d)} label="ارسال موفق (۳۰ روز)" />
          <StatCard icon="⛔" bg="#fef2f2" value={faNumber(overview.deliveries.failed30d)} label="ارسال ناموفق (۳۰ روز)" />
          <StatCard icon="✉️" bg="#f5f3ff" value={faNumber(overview.posts.total)} label="کل پست‌ها" />
          <StatCard icon="📻" bg="var(--brand-soft)" value={faNumber(overview.channels.active)} label="کانال فعال" />
          <StatCard icon="🧠" bg="#fffbeb" value={faNumber(overview.ai.requestCount)} label="درخواست هوش مصنوعی (این ماه)" />
          <StatCard icon="💰" bg="#ecfeff" value={faMoney(overview.wallet.balanceRial)} label="موجودی کیف پول" />
        </div>
      )}

      <Card pad="lg">
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>فعالیت روزانه</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-2)' }}>
          تعداد رویدادهای حساب شما در {faDigits(DAYS_WINDOW)} روز گذشته
        </p>
        {chartError && columns.length === 0 ? (
          <p style={{ color: 'var(--text-2)', fontSize: 13 }}>داده‌ای برای نمایش وجود ندارد.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div
              style={{ display: 'flex', gap: 8, minWidth: 720, alignItems: 'stretch', padding: '6px 2px 0' }}
            >
              {columns.map((c) => {
                const pct = Math.round((c.count / maxCount) * 100);
                return (
                  <div
                    key={c.day}
                    role="img"
                    aria-label={`${faDateShort(c.day)}: ${faCompact(c.count)} رویداد`}
                    title={`${faDateShort(c.day)} — ${faCompact(c.count)} رویداد`}
                    style={{ flex: 1, minWidth: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                  >
                    <span style={{ fontSize: 10.5, color: 'var(--text-2)' }}>{faCompact(c.count)}</span>
                    <div style={{ height: 160, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', width: '100%' }}>
                      <div
                        style={{
                          width: '68%',
                          maxWidth: 40,
                          height: `${Math.max(pct, c.count > 0 ? 5 : 2)}%`,
                          background: c.count > 0 ? 'var(--brand)' : 'var(--border)',
                          borderRadius: 6,
                          transition: 'height 0.2s ease',
                        }}
                        aria-hidden="true"
                      />
                    </div>
                    <span style={{ fontSize: 9.5, whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{faDateShort(c.day)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card pad="lg">
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>آخرین رویدادها</h3>
        {events.length === 0 && !eventsError ? (
          <p style={{ color: 'var(--text-2)', fontSize: 13.5, margin: 0 }}>
            {eventsLoading ? 'در حال بارگذاری…' : 'هنوز رویدادی ثبت نشده است.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {events.map((ev) => (
              <li
                key={ev.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13.5 }}
              >
                <span aria-hidden="true" style={{ fontSize: 16 }}>{EVENT_ICON[ev.name] ?? '•'}</span>
                <strong style={{ fontWeight: 600 }}>{EVENT_FA[ev.name] ?? ev.name}</strong>
                <span style={{ marginInlineStart: 'auto', color: 'var(--text-2)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {faRelative(ev.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {eventsError && events.length > 0 && (
          <p style={{ color: 'var(--danger)', fontSize: 12.5 }}>بارگذاری ادامهٔ فهرست ناموفق بود.</p>
        )}
        {nextCursor && (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <Button variant="ghost" loading={eventsLoading} onClick={() => void loadEvents(nextCursor)}>
              بارگذاری بیشتر
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
