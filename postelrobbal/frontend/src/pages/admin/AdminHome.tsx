import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Card, EmptyState, PageLoading, StatCard } from '../../components/ui';
import { NavIcon } from '../../components/icons';
import { PLATFORM_FA, faFileSize, faMoney, faNumber } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { ADMIN_SECTIONS_FLAT, PlatformIcon, errText, type AdminOverview } from './shared';

/* ------------------------------------------------------------------ */
/* داشبورد مدیریت — overview of users, revenue, platforms, gold,       */
/* posts, usage + quick links to the other 11 sections (Task 16-b).    */
/* ------------------------------------------------------------------ */

const STAT_GRID = { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' } as const;
const TRIO_GRID = { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' } as const;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="adm-metric">
      <span className="adm-metric__label">{label}</span>
      <span className="adm-metric__value">{value}</span>
    </div>
  );
}

function PlatformBreakdown({ title, data }: { title: string; data?: { total?: number; active?: number; telegram?: number; bale?: number; rubika?: number } }) {
  return (
    <Card>
      <div className="adm-card-head">
        <strong>{title}</strong>
        <span className="adm-card-head__meta">
          {faNumber(data?.total ?? 0)} کل · {faNumber(data?.active ?? 0)} فعال
        </span>
      </div>
      <div className="adm-platforms">
        {(['telegram', 'bale', 'rubika'] as const).map((pf) => (
          <div key={pf} className="adm-platform">
            <PlatformIcon platform={pf} size={26} />
            <span className="adm-platform__name">{PLATFORM_FA[pf]}</span>
            <span className="adm-platform__count">{faNumber(data?.[pf] ?? 0)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function AdminHome() {
  const toast = useToast();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void api
      .get<AdminOverview>('/api/v1/admin/overview')
      .then((d) => { if (alive) setData(d); })
      .catch((err: unknown) => { if (alive) toast.error(errText(err, 'دریافت آمار مدیریتی ناموفق بود.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <PageLoading />;

  const users = data?.users;
  const payments = data?.payments;
  const subs = data?.subscriptions;
  const byPlan = subs?.byPlan ?? [];

  return (
    <>
      <div className="adm-page-head">
        <h2>نمای کلی</h2>
        <p>خلاصهٔ وضعیت کاربران، درآمد و زیرساخت سامانه در یک نگاه</p>
      </div>

      <section style={STAT_GRID} aria-label="آمار کاربران و درآمد">
        <StatCard icon="👥" bg="var(--brand-soft)" value={faNumber(users?.total ?? 0)} label="کاربران کل" />
        <StatCard icon="✅" bg="var(--success-soft)" value={faNumber(users?.active ?? 0)} label="کاربران فعال" />
        <StatCard icon="⛔" bg="var(--danger-soft)" value={faNumber(users?.suspended ?? 0)} label="تعلیق‌شده" />
        <StatCard icon="🆕" bg="var(--info-soft)" value={faNumber(users?.new30d ?? 0)} label="جدید ۳۰ روز گذشته" />
        <StatCard icon="💳" bg="var(--success-soft)" value={faMoney(payments?.verifiedSum30d ?? 0)} label="درآمد تأییدشده ۳۰ روز" />
        <StatCard icon="🏦" bg="var(--brand-soft)" value={faMoney(payments?.verifiedSumTotal ?? 0)} label="درآمد کل" />
        <StatCard icon="⏳" bg="var(--warning-soft)" value={faNumber(payments?.pendingReview ?? 0)} label="در انتظار تأیید" />
        <StatCard icon="💎" bg="var(--brand-soft)" value={faNumber(subs?.active ?? 0)} label="اشتراک فعال" />
      </section>

      <div style={TRIO_GRID}>
        <PlatformBreakdown title="کانال‌ها" data={data?.channels} />
        <PlatformBreakdown title="ربات‌ها" data={data?.bots} />
      </div>

      <div style={TRIO_GRID}>
        <Card>
          <div className="adm-card-head"><strong>ربات نرخ طلا</strong></div>
          <div className="adm-metrics">
            <Metric label="کانفیگ‌های ثبت‌شده" value={faNumber(data?.gold?.configs ?? 0)} />
            <Metric label="کانفیگ فعال" value={faNumber(data?.gold?.enabled ?? 0)} />
            <Metric label="اسنپ‌شات ۲۴ ساعت" value={faNumber(data?.gold?.snapshots24h ?? 0)} />
          </div>
        </Card>

        <Card>
          <div className="adm-card-head"><strong>پست‌ها</strong></div>
          <div className="adm-metrics">
            <Metric label="کل پست‌ها" value={faNumber(data?.posts?.total ?? 0)} />
            <Metric label="زمان‌بندی‌شده" value={faNumber(data?.posts?.scheduled ?? 0)} />
            <Metric label="منتشرشده ۳۰ روز" value={faNumber(data?.posts?.published30d ?? 0)} />
            <Metric label="ناموفق ۲۴ ساعت" value={faNumber(data?.posts?.failed24h ?? 0)} />
          </div>
        </Card>

        <Card>
          <div className="adm-card-head"><strong>مصرف سامانه</strong></div>
          <div className="adm-metrics">
            <Metric label="کارهای هوش مصنوعی ۳۰ روز" value={faNumber(data?.usage?.aiJobs30d ?? 0)} />
            <Metric label="رسانه‌ها" value={faNumber(data?.usage?.mediaCount ?? 0)} />
            <Metric label="حجم رسانه‌ها" value={faFileSize(data?.usage?.mediaBytes ?? 0)} />
            <Metric label="تیکت‌های باز" value={faNumber(data?.usage?.ticketsOpen ?? 0)} />
            <Metric label="ارسال ۲۴ ساعت" value={faNumber(data?.usage?.deliveries24h ?? 0)} />
            <Metric label="ارسال ناموفق ۲۴ ساعت" value={faNumber(data?.usage?.deliveriesFailed24h ?? 0)} />
          </div>
        </Card>
      </div>

      <Card>
        <div className="adm-card-head">
          <strong>اشتراک‌های فعال به تفکیک پلن</strong>
          <span className="adm-card-head__meta">{faNumber(subs?.active ?? 0)} اشتراک فعال</span>
        </div>
        {byPlan.length === 0 ? (
          <EmptyState icon="💎" title="اشتراک فعالی ثبت نشده" description="به‌محض فعال‌شدن اشتراک کاربران، تفکیک پلن‌ها اینجا نمایش داده می‌شود." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>پلن</th>
                  <th>مشترکین فعال</th>
                </tr>
              </thead>
              <tbody>
                {byPlan.map((row) => (
                  <tr key={row.planName}>
                    <td style={{ fontWeight: 600 }}>{row.planName}</td>
                    <td>{faNumber(row.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="adm-card-head">
          <strong>دسترسی سریع به بخش‌ها</strong>
        </div>
        <div className="adm-quick">
          {ADMIN_SECTIONS_FLAT.filter((s) => !s.end).map((s) => (
            <Link key={s.to} to={s.to} className="adm-quick__tile">
              <span className="adm-quick__icon" aria-hidden="true"><NavIcon name={s.icon} size={19} /></span>
              <span>{s.label}</span>
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}
