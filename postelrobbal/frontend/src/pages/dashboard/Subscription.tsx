import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError, type PlanDto } from '../../lib/api';
import { Button, Card, EmptyState, Field, PageLoading, Select, StatusBadge } from '../../components/ui';
import { faDate, faDigits, faMoney, faNumber } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';

const SUBSCRIPTION_STATE_FA: Record<string, string> = {
  ACTIVE: 'فعال',
  PENDING: 'در انتظار تأیید',
  EXPIRED: 'منقضی‌شده',
  CANCELLED: 'لغوشده',
  TRIAL: 'دورهٔ آزمایشی',
};

const LIMIT_LABELS_FA: Record<string, string> = {
  max_channels: 'کانال',
  max_posts: 'پست در دوره',
  max_bots: 'ربات',
  max_schedules: 'زمان‌بندی همزمان',
  ai_monthly: 'درخواست هوش مصنوعی در ماه',
  storage_mb: 'فضای ذخیره‌سازی (مگابایت)',
};

const FEATURE_LABELS_FA: Record<string, string> = {
  gold_ticker: 'ربات نرخ لحظه‌ای طلا و سکه',
  auto_responder: 'پاسخگوی خودکار',
  woocommerce: 'ووکامرس',
  api_access: 'دسترسی API',
};

function limitText(value: number | undefined | null): string {
  if (!value || value <= 0) return 'نامحدود';
  return faNumber(value);
}

export default function Subscription() {
  const { me } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [months, setMonths] = useState<number>(1);
  const [buyingCode, setBuyingCode] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ plans?: PlanDto[] }>('/api/v1/subscriptions/plans');
      setPlans(d.plans ?? []);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت پلن‌ها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkout = async (planCode: string) => {
    setBuyingCode(planCode);
    try {
      const d = await api.post<{ redirectUrl?: string }>('/api/v1/subscriptions/checkout', { planCode, months });
      if (d.redirectUrl) {
        window.location.href = d.redirectUrl;
        return;
      }
      toast.error('درگاه پرداخت در دسترس نیست؛ کمی بعد دوباره تلاش کنید.');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ایجاد پرداخت ناموفق بود.');
    } finally {
      setBuyingCode(null);
    }
  };

  if (loading) return <PageLoading />;

  const current = me?.subscription ?? null;
  const currentPlanCode = current?.planCode ?? null;

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 21, fontWeight: 800 }}>اشتراک و پلن‌ها</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>پلن مناسب کسب‌وکار خود را انتخاب کنید؛ ارتقا بلافاصله پس از پرداخت فعال می‌شود.</p>
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', marginBottom: 24 }}>
        {plans.length === 0 ? (
          <EmptyState icon="💎" title="پلنی برای نمایش نیست" description="فهرست پلن‌ها در دسترس نیست؛ کمی بعد دوباره تلاش کنید." />
        ) : (
          plans.map((plan) => {
            const isCurrent = currentPlanCode === plan.code;
            const features = plan.featuresJson ?? ({} as PlanDto['featuresJson']);
            const limits = plan.limitsJson ?? ({} as PlanDto['limitsJson']);
            return (
              <Card key={plan.id} pad="lg">
                {isCurrent && (
                  <span className="badge badge-success" style={{ marginBottom: 10 }}>پلن فعلی شما</span>
                )}
                <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>{plan.nameFa}</h2>
                <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--brand-strong)', marginBottom: 14 }}>
                  {faMoney(plan.priceRial)}
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}> / ماهانه</span>
                </div>

                <ul style={{ listStyle: 'none', display: 'grid', gap: 5, fontSize: 13, marginBottom: 14, color: 'var(--text-2)' }}>
                  {Object.entries(LIMIT_LABELS_FA).map(([key, label]) => (
                    <li key={key}>
                      ✔ {label}: <strong style={{ color: 'var(--text)' }}>{limitText(limits[key as keyof PlanDto['limitsJson']])}</strong>
                    </li>
                  ))}
                </ul>

                <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 10, marginBottom: 16, display: 'grid', gap: 4, fontSize: 13 }}>
                  {Object.entries(FEATURE_LABELS_FA).map(([key, label]) => {
                    const on = features[key as keyof PlanDto['featuresJson']] === true;
                    return (
                      <span key={key} style={{ color: on ? 'var(--text)' : 'var(--text-2)' }}>
                        <span aria-hidden="true">{on ? '✔' : '✖'}</span> {label}
                      </span>
                    );
                  })}
                </div>

                <Button
                  block
                  variant={isCurrent ? 'ghost' : 'primary'}
                  loading={buyingCode === plan.code}
                  onClick={() => setSelectedCode(plan.code)}
                >
                  {isCurrent ? 'تمدید اشتراک' : 'انتخاب این پلن'}
                </Button>
              </Card>
            );
          })
        )}
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', maxWidth: 900 }}>
        {current && (
          <Card>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>اشتراک فعلی</h2>
            <ul style={{ listStyle: 'none', display: 'grid', gap: 6, fontSize: 13.5 }}>
              <li>پلن: <strong>{current.planName}</strong></li>
              <li>تاریخ انقضا: <strong>{faDate(current.expiresAt)}</strong></li>
              <li>
                وضعیت: <StatusBadge state={current.state} labels={SUBSCRIPTION_STATE_FA} />
              </li>
            </ul>
          </Card>
        )}

        {selectedCode && (
          <Card>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>تکمیل خرید</h2>
            <Field label="مدت اشتراک" required hint="پس از انتخاب مدت، به درگاه بانکی هدایت می‌شوید.">
              <Select value={String(months)} onChange={(e) => setMonths(Number(e.target.value))}>
                {[1, 3, 6, 12].map((m) => (
                  <option key={m} value={m}>{faDigits(m)} ماه</option>
                ))}
              </Select>
            </Field>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button loading={buyingCode === selectedCode} onClick={() => void checkout(selectedCode)}>پرداخت و رفتن به درگاه</Button>
              <Button variant="ghost" onClick={() => setSelectedCode(null)}>انصراف</Button>
            </div>
          </Card>
        )}

        {!current && !selectedCode && (
          <Card>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>اشتراکی ندارید</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
              برای استفاده از تمام امکانات، یکی از پلن‌ها را انتخاب کنید. پس از پرداخت موفق، اشتراک شما بلافاصله فعال می‌شود.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
