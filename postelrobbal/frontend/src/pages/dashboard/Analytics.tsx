import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Card, EmptyState, PageLoading, StatCard } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { faCompact, faDate, faDateShort, faDigits, faMoney, faNumber, faPercent, faRelative } from '../../lib/format';

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

/** Per-day aggregate used by the chart + tooltip (all real /analytics/daily fields). */
interface DayStat {
  day: string;
  total: number;
  sent: number;
  failed: number;
  other: number;
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

/** Ring helper: circumference of r=17 */
const RING_R = 17;
const RING_C = 2 * Math.PI * RING_R;

/** 7-day mini sparkline for the tooltip (SVG, no deps). */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 36;
  const n = values.length;
  const points = values.map((v, i) => {
    const x = n <= 1 ? w : (i * w) / (n - 1);
    const y = 31 - (v / max) * 27;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 36, display: 'block' }} aria-hidden="true">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1].split(',')[0]}
          cy={points[points.length - 1].split(',')[1]}
          r="3"
          fill="var(--brand-strong)"
        />
      )}
    </svg>
  );
}

export default function Analytics() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewDto | null>(null);
  const [columns, setColumns] = useState<DayStat[]>([]);
  const [events, setEvents] = useState<EventRowDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [chartError, setChartError] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  // On narrow phones show 7 days so the chart never needs horizontal scrolling.
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 560px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 560px)');
    const onChange = (e: MediaQueryListEvent) => {
      setCompact(e.matches);
      setActiveIdx(null);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Escape closes the tooltip popover.
  useEffect(() => {
    if (activeIdx === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveIdx(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeIdx]);

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
      // Daily counts are per-eventName rows; aggregate client-side.
      // post.sent / post.failed become the tooltip's sent/failed breakdown,
      // every other event name goes to «سایر».
      const sinceMs = Date.now() - (DAYS_WINDOW - 1) * 24 * 3600 * 1000;
      const buckets = new Map<string, DayStat>();
      for (let i = 0; i < DAYS_WINDOW; i++) {
        const d = new Date(sinceMs + i * 24 * 3600 * 1000);
        buckets.set(d.toISOString().slice(0, 10), { day: d.toISOString().slice(0, 10), total: 0, sent: 0, failed: 0, other: 0 });
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
          const bucket = buckets.get(key);
          if (!bucket) continue;
          if (row.eventName === 'post.sent') bucket.sent += row.count ?? 0;
          else if (row.eventName === 'post.failed') bucket.failed += row.count ?? 0;
          else bucket.other += row.count ?? 0;
          bucket.total += row.count ?? 0;
        }
        // Ascending by date (oldest → newest). The chart row is explicitly RTL,
        // so the oldest day renders on the RIGHT and the newest on the LEFT —
        // the natural right-to-left time flow of Persian charts.
        setColumns(
          Array.from(buckets.entries())
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([, stat]) => stat)
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

  const visible = compact ? columns.slice(-7) : columns;
  const maxCount = Math.max(1, ...visible.map((c) => c.total));
  const active = activeIdx !== null ? visible[activeIdx] : undefined;
  const activeRate =
    active && active.sent + active.failed > 0 ? active.sent / (active.sent + active.failed) : null;
  const sparkValues =
    activeIdx !== null ? visible.slice(Math.max(0, activeIdx - 6), activeIdx + 1).map((c) => c.total) : [];

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
          تعداد رویدادهای حساب شما در {faDigits(visible.length)} روز گذشته — قدیمی‌ترین روز سمت راست، امروز سمت چپ
        </p>
        {chartError && visible.length === 0 ? (
          <p style={{ color: 'var(--text-2)', fontSize: 13 }}>داده‌ای برای نمایش وجود ندارد.</p>
        ) : (
          <div
            className="achart"
            onClick={(e) => {
              // tap-away closes the tooltip on touch devices
              if (activeIdx !== null && !(e.target as HTMLElement).closest('.achart__bar')) setActiveIdx(null);
            }}
          >
            <div className="achart__row" onMouseLeave={() => setActiveIdx(null)}>
              {visible.map((c, i) => {
                const pct = Math.round((c.total / maxCount) * 100);
                const isActive = activeIdx === i;
                // Tooltip flip: near the chart's right edge anchor to the right,
                // near the left edge anchor to the left, otherwise centered.
                const tipPos = i <= 1 ? 'start' : i >= visible.length - 2 ? 'end' : 'center';
                return (
                  <div key={c.day} className="achart__col">
                    <span className="achart__count">{faCompact(c.total)}</span>
                    <div className="achart__barzone">
                      <button
                        type="button"
                        className={`achart__bar${c.total === 0 ? ' achart__bar--zero' : ''}${isActive ? ' is-active' : ''}`}
                        style={{ height: `${Math.max(pct, c.total > 0 ? 5 : 2)}%` }}
                        onMouseEnter={() => setActiveIdx(i)}
                        onFocus={() => setActiveIdx(i)}
                        onBlur={() => setActiveIdx((cur) => (cur === i ? null : cur))}
                        onClick={() => setActiveIdx((cur) => (cur === i ? null : i))}
                        aria-label={`${faDate(c.day)}: ${faNumber(c.total)} رویداد`}
                        aria-pressed={isActive}
                      />
                      {isActive && (
                        <div className={`achart__tip achart__tip--${tipPos}`} role="presentation">
                          <div className="achart__tipbody">
                            <div className="achart__tip__head">
                              <span className="achart__tip__date">{faDate(c.day)}</span>
                              {i === visible.length - 1 && <span className="achart__tip__today">امروز</span>}
                            </div>
                            <div className="achart__tip__rows">
                              <div className="achart__tip__row">
                                <strong style={{ marginInlineStart: 0 }}>مجموع رویدادها</strong>
                                <strong>{faNumber(c.total)}</strong>
                              </div>
                              <div className="achart__tip__row">
                                <span className="achart__dot achart__dot--sent" aria-hidden="true" />
                                ارسال موفق
                                <strong>{faNumber(c.sent)}</strong>
                              </div>
                              <div className="achart__tip__row">
                                <span className="achart__dot achart__dot--failed" aria-hidden="true" />
                                شکست ارسال
                                <strong>{faNumber(c.failed)}</strong>
                              </div>
                              <div className="achart__tip__row">
                                <span className="achart__dot achart__dot--other" aria-hidden="true" />
                                سایر رویدادها
                                <strong>{faNumber(c.other)}</strong>
                              </div>
                            </div>
                            <div className="achart__tip__viz">
                              <svg width="44" height="44" viewBox="0 0 44 44" role="img" aria-label={activeRate !== null ? `نرخ موفقیت ${faPercent(activeRate)}` : 'نرخ موفقیت ثبت نشده'}>
                                <circle cx="22" cy="22" r={RING_R} fill="none" stroke="#e8eaf2" strokeWidth="4.5" />
                                {activeRate !== null && (
                                  <circle
                                    cx="22"
                                    cy="22"
                                    r={RING_R}
                                    fill="none"
                                    stroke={activeRate >= 0.8 ? 'var(--success)' : activeRate >= 0.5 ? 'var(--warning)' : 'var(--danger)'}
                                    strokeWidth="4.5"
                                    strokeLinecap="round"
                                    strokeDasharray={RING_C}
                                    strokeDashoffset={RING_C * (1 - activeRate)}
                                    transform="rotate(-90 22 22)"
                                    style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                                  />
                                )}
                                <text x="22" y="26" textAnchor="middle" className="achart__ringtext">
                                  {activeRate !== null ? faPercent(activeRate) : '—'}
                                </text>
                              </svg>
                              <div className="achart__spark">
                                <span className="achart__spark__label">روند {faDigits(sparkValues.length)} روز اخیر</span>
                                <Spark values={sparkValues} />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="achart__date" style={isActive ? { color: 'var(--brand-strong)', fontWeight: 700 } : undefined}>
                      {faDateShort(c.day)}
                    </span>
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
