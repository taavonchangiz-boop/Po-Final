import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Receipt } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton, SkeletonText } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { get, post, ApiError } from '../../lib/api';
import { faMoney, faDate, faDateTime, toFa, labelOf } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { errorMessage, ErrorCard } from '../publishing/parts';
import {
  paymentStatusLabels,
  paymentStatusTones,
  paymentPurposeLabels,
  gatewayLabels,
  planLimitLabels,
  openGatewayRedirect,
} from './billingParts';

/**
 * Subscription — plans + current subscription + payment history.
 * Shapes verified against app/src/modules/billing/billing.routes.ts +
 * subscription.service.ts + payment.service.ts:
 *  - GET /plans (public) → { items: [{ id, code, name, description, priceMonthly, limits, sortOrder }] }.
 *  - GET /subscription → { subscription | null, plan: { id, code, name, priceMonthly }, limits }.
 *  - POST /subscription/change { planId } → { paymentId, redirectUrl, applied } —
 *    zero-price plans apply immediately (applied=true); paid plans return the
 *    gateway redirect (browser is redirected server-verified callback flows).
 *  - GET /payments?page&limit → { items: [{ id, purpose, planId, amount, gateway,
 *    status, authority, gatewayRef, verifiedAt, createdAt }], total, page, limit }.
 *  - The endpoint does NOT return per-limit usage — usage bars are shown only
 *    for AI credits, which GET /ai/usage does expose.
 */

interface PlanRecord {
  id: number | string;
  code?: string;
  name?: string;
  description?: string | null;
  priceMonthly?: number;
  limits?: Record<string, number>;
  sortOrder?: number;
}

interface SubscriptionRecord {
  id?: number | string;
  planId?: number;
  status?: string;
  startedAt?: string;
  expiresAt?: string | null;
  cancelledAt?: string | null;
}

interface SubscriptionResponse {
  subscription?: SubscriptionRecord | null;
  plan?: { id?: number; code?: string; name?: string; priceMonthly?: number };
  limits?: Record<string, number>;
}

interface AiUsageResponse {
  used?: number;
  quota?: number;
  month?: string;
}

interface PaymentRecord {
  id: number | string;
  purpose?: string;
  planId?: number | null;
  amount?: number;
  gateway?: string;
  status?: string;
  gatewayRef?: string | null;
  verifiedAt?: string | null;
  createdAt?: string;
}

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'فعال',
  EXPIRED: 'منقضی‌شده',
  CANCELLED: 'لغو شده',
  PENDING_PAYMENT: 'در انتظار پرداخت',
};

function daysRemaining(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 86_400_000));
}

export default function SubscriptionPage() {
  usePageTitle('اشتراک');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [searchParams, setSearchParams] = useSearchParams();

  // Gateway browser-return flow: /app/subscription?payment=ok|failed.
  const paymentResult = searchParams.get('payment');
  useEffect(() => {
    if (paymentResult === 'ok') {
      pushToast('success', 'پرداخت با موفقیت تأیید شد و اشتراک شما فعال گردید.');
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] });
      void setSearchParams({}, { replace: true });
    } else if (paymentResult === 'failed') {
      pushToast('error', 'پرداخت ناموفق بود؛ اشتراک تغییر نکرد.');
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentResult]);

  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => get<{ items?: PlanRecord[] }>('/plans'),
  });

  const current = useQuery({
    queryKey: ['subscription'],
    queryFn: () => get<SubscriptionResponse>('/subscription'),
  });

  const aiUsage = useQuery({
    queryKey: ['ai', 'usage'],
    queryFn: () => get<AiUsageResponse>('/ai/usage'),
  });

  const currentPlanId = current.data?.plan?.id;
  const isCurrentPlan = (plan: PlanRecord) =>
    currentPlanId !== undefined && String(currentPlanId) === String(plan.id);

  const changeMutation = useMutation({
    mutationFn: (planId: number | string) =>
      post<{ paymentId: number | null; redirectUrl: string | null; applied: boolean }>(
        '/subscription/change',
        { planId },
      ),
    onSuccess: (data) => {
      if (data?.applied) {
        pushToast('success', 'پلن شما با موفقیت فعال شد.');
        void queryClient.invalidateQueries({ queryKey: ['subscription'] });
        void queryClient.invalidateQueries({ queryKey: ['payments'] });
        void queryClient.invalidateQueries({ queryKey: ['me'] });
        return;
      }
      if (data?.redirectUrl) {
        pushToast('info', 'در حال انتقال به درگاه پرداخت…');
        openGatewayRedirect(data.redirectUrl);
        return;
      }
      if (data?.paymentId) {
        pushToast(
          'info',
          `پرداخت #${toFa(data.paymentId)} ایجاد شد اما درگاه در دسترس نیست؛ بعداً از تاریخچه پرداخت پیگیری کنید.`,
        );
      }
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  const payments = usePaged<PaymentRecord>({
    queryKey: ['payments'],
    buildPath: (page, limit) => `/payments?page=${page}&limit=${limit}`,
  });

  const sub = current.data?.subscription;
  const remaining = daysRemaining(sub?.expiresAt);

  return (
    <>
      <PageHeader
        title="اشتراک"
        description="پلن فعلی، سقف‌ها و تاریخچه پرداخت‌ها"
      />

      <div className="space-y-6">
        {/* ------------------------------ current plan ------------------------------ */}
        {current.isLoading ? (
          <Card>
            <CardBody className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <SkeletonText lines={3} />
            </CardBody>
          </Card>
        ) : current.error ? (
          <ErrorCard message={errorMessage(current.error)} onRetry={() => void current.refetch()} />
        ) : (
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <CreditCard aria-hidden="true" className="size-4 text-primary-700" />
                پلن فعلی
              </CardTitle>
              <Badge state={sub?.status} labels={SUBSCRIPTION_STATUS_LABELS} />
            </CardHeader>
            <CardBody>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-neutral-900">{current.data?.plan?.name || 'رایگان'}</p>
                  <p className="mt-1 text-sm text-neutral-500">
                    {sub?.expiresAt ? (
                      <>
                        تاریخ انقضا: {faDate(sub.expiresAt)}
                        {remaining !== null ? ` · ${toFa(remaining)} روز باقی‌مانده` : ''}
                      </>
                    ) : (
                      'بدون اشتراک فعال — سقف‌های پلن رایگان اعمال می‌شود.'
                    )}
                  </p>
                </div>
                <p className="text-sm font-medium text-neutral-700">
                  {typeof current.data?.plan?.priceMonthly === 'number'
                    ? current.data.plan.priceMonthly > 0
                      ? `${faMoney(current.data.plan.priceMonthly)} /ماه`
                      : 'رایگان'
                    : '—'}
                </p>
              </div>

              {/* Limits list (usage bars only for AI credits — the only usage the API exposes) */}
              <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {planLimitLabels.map(({ key, label }) => {
                  const limit = current.data?.limits?.[key];
                  const isAi = key === 'aiCredits';
                  const aiUsed = isAi ? (aiUsage.data?.used ?? 0) : 0;
                  const pct = isAi && typeof limit === 'number' && limit > 0 ? Math.min(100, Math.round((aiUsed / limit) * 100)) : 0;
                  return (
                    <li key={key} className="rounded-xl border border-neutral-200 p-3">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-neutral-600">{label}</span>
                        <span className="font-bold text-neutral-900">{typeof limit === 'number' ? toFa(limit) : '—'}</span>
                      </div>
                      {isAi && typeof limit === 'number' && limit > 0 && (
                        <div
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="مصرف اعتبار هوش مصنوعی در برابر سهمیه پلن"
                          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100"
                        >
                          <div
                            className={'h-full rounded-full ' + (pct >= 90 ? 'bg-red-500' : 'bg-primary-600')}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        )}

        {/* ------------------------------- plans grid ------------------------------- */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-neutral-900">انتخاب پلن</h2>
          {plans.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Card key={i} className="p-5">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="mt-3 h-8 w-32" />
                  <SkeletonText className="mt-4" lines={3} />
                </Card>
              ))}
            </div>
          ) : plans.error ? (
            <ErrorCard message={errorMessage(plans.error)} onRetry={() => void plans.refetch()} />
          ) : (plans.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="پلنی برای نمایش نیست"
              description="پلن‌ها به‌زودی اعلام می‌شوند؛ در صورت نیاز با پشتیبانی تماس بگیرید."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(plans.data?.items ?? []).map((plan) => {
                const currentPlan = isCurrentPlan(plan);
                return (
                  <Card key={String(plan.id)} className={currentPlan ? 'border-primary-300 ring-1 ring-primary-200' : undefined}>
                    <CardBody className="flex h-full flex-col">
                      <p className="text-base font-bold text-neutral-900">{plan.name || plan.code || '—'}</p>
                      <p className="mt-1 text-xl font-bold text-primary-800">
                        {typeof plan.priceMonthly === 'number' && plan.priceMonthly > 0 ? (
                          <>
                            {faMoney(plan.priceMonthly)}
                            <span className="ms-1 text-xs font-normal text-neutral-500">/ماه</span>
                          </>
                        ) : (
                          'رایگان'
                        )}
                      </p>
                      {plan.description ? (
                        <p className="mt-2 text-xs leading-6 text-neutral-500">{plan.description}</p>
                      ) : null}
                      <ul className="mt-3 flex-1 space-y-1.5">
                        {planLimitLabels.map(({ key, label }) => (
                          <li key={key} className="flex items-center justify-between gap-2 text-xs text-neutral-600">
                            <span>{label}</span>
                            <span className="font-medium text-neutral-800">
                              {typeof plan.limits?.[key] === 'number' ? toFa(plan.limits[key] as number) : '—'}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4">
                        {currentPlan ? (
                          <Button variant="secondary" className="w-full" disabled>
                            پلن فعلی
                          </Button>
                        ) : (
                          <Button
                            className="w-full"
                            loading={changeMutation.isPending && String(changeMutation.variables) === String(plan.id)}
                            disabled={changeMutation.isPending}
                            onClick={() => changeMutation.mutate(plan.id)}
                          >
                            {typeof plan.priceMonthly === 'number' && plan.priceMonthly > 0 ? 'انتخاب و پرداخت' : 'انتخاب پلن'}
                          </Button>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* ----------------------------- payment history ----------------------------- */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-neutral-900">
            <Receipt aria-hidden="true" className="size-4 text-primary-700" />
            تاریخچه پرداخت‌ها
          </h2>
          {payments.isLoading ? (
            <Card>
              <CardBody className="space-y-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </CardBody>
            </Card>
          ) : payments.error ? (
            <ErrorCard message={errorMessage(payments.error)} onRetry={() => void payments.refetch()} />
          ) : payments.items.length === 0 ? (
            <EmptyState
              title="پرداختی ثبت نشده است"
              description="پس از اولین پرداخت، وضعیت و جزئیات آن اینجا نمایش داده می‌شود."
            />
          ) : (
            <>
              <Table caption="تاریخچه پرداخت‌ها">
                <THead>
                  <TR>
                    <TH>مبلغ</TH>
                    <TH>هدف</TH>
                    <TH>درگاه</TH>
                    <TH>وضعیت</TH>
                    <TH>تاریخ</TH>
                  </TR>
                </THead>
                <TBody>
                  {payments.items.map((p) => (
                    <TR key={String(p.id)}>
                      <TD className="font-medium text-neutral-900">{faMoney(p.amount ?? 0)}</TD>
                      <TD>{labelOf(paymentPurposeLabels, p.purpose)}</TD>
                      <TD>{labelOf(gatewayLabels, p.gateway)}</TD>
                      <TD>
                        <Badge tone={paymentStatusTones[p.status ?? ''] ?? 'neutral'}>
                          {labelOf(paymentStatusLabels, p.status)}
                        </Badge>
                      </TD>
                      <TD className="text-xs text-neutral-500">{faDateTime(p.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination className="mt-4" page={payments.page} totalPages={payments.totalPages} onChange={payments.setPage} />
            </>
          )}
        </div>

        <p className="text-xs leading-6 text-neutral-400">
          پرداخت‌ها از طریق درگاه‌های بانکی انجام و پس از بازگشت، به‌صورت خودکار تأیید می‌شوند. در صورت بروز مشکل با{' '}
          <Link to="/app/support" className="font-medium text-primary-700 hover:underline">
            پشتیبانی
          </Link>{' '}
          تماس بگیرید.
        </p>
      </div>
    </>
  );
}
