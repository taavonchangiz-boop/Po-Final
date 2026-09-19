import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError, type NotificationDto, type Page } from '../../lib/api';
import { Button, Card, EmptyState, PageLoading, StatCard, StatusBadge } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { faDate, faDigits, faMoney, faNumber, faRelative } from '../../lib/format';

/** Shape returned by GET /api/v1/analytics/overview (client already unwraps `data`). */
interface OverviewDto {
  channels: { total: number; active: number };
  bots: { total: number; active: number };
  posts: { total: number; published: number };
  deliveries: { sent30d: number; failed30d: number };
  wallet: { balanceRial: number };
  ai: { periodYm: string; requestCount: number; tokenCount: number };
}

const SUB_STATE_FA: Record<string, string> = {
  ACTIVE: 'فعال',
  PENDING: 'در انتظار پرداخت',
  EXPIRED: 'منقضی شده',
  CANCELLED: 'لغو شده',
};

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

export default function Dashboard() {
  const { me } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewDto | null>(null);
  const [notifs, setNotifs] = useState<NotificationDto[]>([]);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [ov, np] = await Promise.all([
        api.get<OverviewDto>('/api/v1/analytics/overview'),
        api.get<Page<NotificationDto>>('/api/v1/notifications?pageSize=5'),
      ]);
      setOverview(ov);
      setNotifs(np.items ?? []);
    } catch (e) {
      setLoadError(true);
      toast.error(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <PageLoading />;

  if (loadError || !overview) {
    return (
      <EmptyState
        icon="📡"
        title="داده‌ها بارگذاری نشد"
        description="در دریافت اطلاعات داشبورد مشکلی پیش آمد. لطفاً دوباره تلاش کنید."
        action={<Button onClick={() => void load()}>تلاش مجدد</Button>}
      />
    );
  }

  const sub = me?.subscription ?? null;
  const hasChannels = overview.channels.total > 0;
  const firstName = me?.user.firstName?.trim() || 'کاربر';

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>سلام، {firstName} 👋</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5, margin: 0 }}>
          این خلاصهٔ وضعیت حساب شما در پُستیار است.
        </p>
      </div>

      {!hasChannels && (
        <EmptyState
          icon="📻"
          title="هنوز کانالی متصل نکرده‌اید"
          description="برای انتشار پست، ابتدا اولین کانال خود را در تلگرام، بله یا روبیکا متصل کنید."
          action={
            <Link to="/dashboard/channels" className="btn btn-primary">
              اتصال اولین کانال
            </Link>
          }
        />
      )}

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))' }}>
        <StatCard icon="📻" bg="var(--brand-soft)" value={faNumber(overview.channels.total)} label="کانال متصل" />
        <StatCard icon="🤖" bg="#ecfeff" value={faNumber(overview.bots.total)} label="ربات" />
        <StatCard icon="✉️" bg="#f5f3ff" value={faNumber(overview.posts.total)} label="پست ثبت‌شده" />
        <StatCard icon="🚀" bg="#ecfdf5" value={faNumber(overview.deliveries.sent30d)} label="ارسال موفق (۳۰ روز گذشته)" />
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <Card pad="lg">
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>اشتراک شما</h3>
          {sub ? (
            <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{sub.planName}</span>
                <StatusBadge state={sub.state} labels={SUB_STATE_FA} />
              </div>
              <div style={{ color: 'var(--text-2)' }}>
                تاریخ پایان: <strong style={{ color: 'var(--text)' }}>{faDate(sub.expiresAt)}</strong>
              </div>
              <div style={{ color: 'var(--text-2)' }}>
                موجودی کیف پول: <strong style={{ color: 'var(--text)' }}>{faMoney(overview.wallet.balanceRial)}</strong>
              </div>
              <Link to="/dashboard/subscription" className="btn btn-soft btn-sm" style={{ justifySelf: 'start', marginTop: 4 }}>
                مدیریت اشتراک
              </Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12, fontSize: 13.5, color: 'var(--text-2)' }}>
              <p style={{ margin: 0 }}>در حال حاضر اشتراک فعالی ندارید. برای انتشار نامحدود پست، یکی از پلن‌ها را فعال کنید.</p>
              <Link to="/dashboard/subscription" className="btn btn-primary btn-sm" style={{ justifySelf: 'start' }}>
                خرید اشتراک
              </Link>
            </div>
          )}
        </Card>

        <Card pad="lg">
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>دسترسی سریع</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <Link to="/dashboard/posts/new" className="btn btn-primary">✍️ پست جدید</Link>
            <Link to="/dashboard/channels" className="btn btn-ghost">📻 اتصال کانال</Link>
            <Link to="/dashboard/subscription" className="btn btn-ghost">💎 خرید اشتراک</Link>
          </div>
        </Card>
      </div>

      <Card pad="lg">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>اعلان‌های اخیر</h3>
          <Link to="/dashboard/notifications" style={{ fontSize: 12.5 }}>مشاهده همه</Link>
        </div>
        {notifs.length === 0 ? (
          <p style={{ color: 'var(--text-2)', fontSize: 13.5, margin: 0 }}>اعلانی ندارید.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 0 }}>
            {notifs.map((n) => (
              <li key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13.5, fontWeight: n.readAt ? 500 : 700 }}>{n.titleFa}</strong>
                  {!n.readAt && <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--brand)', display: 'inline-block' }} aria-label="خوانده‌نشده" />}
                  <span style={{ color: 'var(--text-2)', fontSize: 11.5, marginInlineStart: 'auto' }}>{faRelative(n.createdAt)}</span>
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--text-2)' }}>{n.bodyFa}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p style={{ color: 'var(--text-2)', fontSize: 12, margin: 0 }}>
        تعداد پست‌های منتشرشده: {faNumber(overview.posts.published)} — درخواست‌های هوش مصنوعی این ماه: {faDigits(overview.ai.requestCount)}
      </p>
    </div>
  );
}
