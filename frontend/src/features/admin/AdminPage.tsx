import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, LifeBuoy, ScrollText, Send, Shield, Users, WalletCards, X } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { usePageTitle } from '../../app/usePageTitle';
import { get, put, post, ApiError } from '../../lib/api';
import { faMoney, faDateTime, faNumber, labelOf } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { errorMessage, ErrorCard } from '../publishing/parts';
import { gatewayLabels, paymentPurposeLabels, paymentStatusLabels } from '../billing/billingParts';

/**
 * Admin dashboard — platform KPIs + quick links + payment management.
 * Shapes verified against app/src/modules/admin/admin.service.ts + admin.routes.ts:
 *  GET /admin/stats → { users, activeSubscriptions, paymentsVerifiedMonthTotal,
 *  deliveriesSent30d, openTickets }.
 *
 * Task 10-d additions:
 *  - GET/PUT /admin/settings/payment → { settings: { online_gateway_enabled,
 *    online_gateway, card_enabled, card_number, card_holder } } — online gateway
 *    + card-to-card toggles (audited server-side on save).
 *  - GET /admin/payments?status=PENDING + POST /admin/payments/:id/approve|reject
 *    — manual review of card-to-card payments (PENDING rows, method=CARD).
 */

interface AdminStats {
  users?: number;
  activeSubscriptions?: number;
  paymentsVerifiedMonthTotal?: number;
  deliveriesSent30d?: number;
  openTickets?: number;
}

const QUICK_LINKS = [
  { to: '/app/admin/users', label: 'کاربران', description: 'نقش‌ها، وضعیت و جست‌وجو', icon: Users },
  { to: '/app/admin/tickets', label: 'تیکت‌ها', description: 'پاسخ به درخواست‌های کاربران', icon: LifeBuoy },
  { to: '/app/admin/plans', label: 'پلن‌ها', description: 'قیمت و سقف هر پلن', icon: CreditCard },
  { to: '/app/admin/audit', label: 'رخدادهای مدیریتی', description: 'گزارش کامل اقدامات', icon: ScrollText },
] as const;

/* ------------------------------ payment settings ------------------------------ */

interface PaymentSettings {
  online_gateway_enabled?: boolean;
  online_gateway?: string | null;
  card_enabled?: boolean;
  card_number?: string;
  card_holder?: string;
}

const GATEWAY_OPTIONS = ['ZARINPAL', 'IDPAY', 'ZIBAL', 'MOCK'] as const;

/** RTL-friendly toggle switch (persian labels handled by the caller). */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 px-3.5 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-neutral-800">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-5 text-neutral-400">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={
          'focus-ring inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ' +
          (checked ? 'justify-end bg-primary-600' : 'justify-start bg-neutral-300')
        }
      >
        <span className="inline-block size-5 rounded-full bg-white shadow-sm" />
      </button>
    </div>
  );
}

function PaymentSettingsForm({ initial }: { initial: PaymentSettings }) {
  const pushToast = useUiStore((s) => s.pushToast);
  const queryClient = useQueryClient();
  const [onlineEnabled, setOnlineEnabled] = useState(initial.online_gateway_enabled === true);
  const [gateway, setGateway] = useState<string>(initial.online_gateway ?? '');
  const [cardEnabled, setCardEnabled] = useState(initial.card_enabled === true);
  const [cardNumber, setCardNumber] = useState(initial.card_number ?? '');
  const [cardHolder, setCardHolder] = useState(initial.card_holder ?? '');

  const saveMutation = useMutation({
    mutationFn: () =>
      put<{ settings: PaymentSettings }>('/admin/settings/payment', {
        onlineGatewayEnabled: onlineEnabled,
        onlineGateway: gateway !== '' ? gateway : undefined,
        cardEnabled,
        cardNumber: cardNumber.trim(),
        cardHolder: cardHolder.trim(),
      }),
    onSuccess: () => {
      pushToast('success', 'تنظیمات پرداخت ذخیره شد.');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'payment-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  return (
    <div className="space-y-4">
      <ToggleRow
        label="درگاه پرداخت آنلاین"
        hint="پرداخت آنلاین از طریق درگاه بانکی (زرین‌پال / آیدی‌پی / زیبال) بر اساس تنظیمات سرور."
        checked={onlineEnabled}
        onChange={setOnlineEnabled}
      />
      {onlineEnabled ? (
        <Select
          label="درگاه پرداخت"
          value={gateway}
          onChange={(e) => setGateway(e.target.value)}
          hint="درگاهی که پرداخت‌های آنلاین از طریق آن انجام می‌شود."
        >
          <option value="">— انتخاب درگاه —</option>
          {GATEWAY_OPTIONS.map((g) => (
            <option key={g} value={g}>
              {gatewayLabels[g] ?? g}
            </option>
          ))}
        </Select>
      ) : null}

      <ToggleRow
        label="پرداخت کارت به کارت"
        hint="کاربران مبلغ را به کارت زیر واریز و شماره پیگیری را ثبت می‌کنند؛ تأیید نهایی با مدیر است."
        checked={cardEnabled}
        onChange={setCardEnabled}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="شماره کارت"
          dir="ltr"
          inputMode="numeric"
          placeholder="6037XXXXXXXXXXXX"
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          hint="۱۶ رقم، بدون فاصله — پیش‌نمایش با فاصله در بخش کارت به کارت."
        />
        <Input
          label="نام صاحب کارت"
          placeholder="نام و نام خانوادگی"
          value={cardHolder}
          onChange={(e) => setCardHolder(e.target.value)}
          hint="نام صاحب حساب که به کاربران نمایش داده می‌شود."
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          ذخیره تنظیمات پرداخت
        </Button>
      </div>
    </div>
  );
}

function PaymentSettingsCard() {
  const settings = useQuery({
    queryKey: ['admin', 'payment-settings'],
    queryFn: () => get<{ settings?: PaymentSettings }>('/admin/settings/payment'),
  });

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <WalletCards aria-hidden="true" className="size-4 text-primary-700" />
          تنظیمات پرداخت
        </CardTitle>
        <span className="text-xs text-neutral-400">درگاه آنلاین + کارت به کارت</span>
      </CardHeader>
      <CardBody>
        {settings.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : settings.error ? (
          <ErrorCard message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
        ) : (
          <PaymentSettingsForm initial={settings.data?.settings ?? {}} />
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------- card-to-card payment review ------------------------- */

interface AdminPaymentRow {
  id: number | string;
  userId?: number;
  userEmail?: string;
  purpose?: string;
  amount?: number;
  method?: string;
  gateway?: string;
  status?: string;
  reference?: string | null;
  createdAt?: string;
}

function CardPaymentsCard() {
  const pushToast = useUiStore((s) => s.pushToast);
  const queryClient = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<AdminPaymentRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const pending = useQuery({
    queryKey: ['admin', 'payments', 'pending-card'],
    queryFn: () => get<{ items?: AdminPaymentRow[]; total?: number }>('/admin/payments?status=PENDING&limit=50'),
  });
  const rows = (pending.data?.items ?? []).filter((p) => p.method === 'CARD');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'payments'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: number | string) => post<{ payment?: AdminPaymentRow }>(`/admin/payments/${String(id)}/approve`, {}),
    onSuccess: (_data, id) => {
      pushToast('success', `پرداخت #${faNumber(Number(id))} تأیید و اعمال شد.`);
      invalidate();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (input: { id: number | string; reason: string }) =>
      post<{ payment?: AdminPaymentRow }>(`/admin/payments/${String(input.id)}/reject`, {
        reason: input.reason.trim().length > 0 ? input.reason.trim() : undefined,
      }),
    onSuccess: (_data, input) => {
      pushToast('success', `پرداخت #${faNumber(Number(input.id))} رد شد و به کاربر اطلاع داده شد.`);
      setRejectTarget(null);
      setRejectReason('');
      invalidate();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <WalletCards aria-hidden="true" className="size-4 text-primary-700" />
          پرداخت‌های کارت به کارت
        </CardTitle>
        <Badge tone={rows.length > 0 ? 'warning' : 'neutral'}>در انتظار تأیید: {faNumber(rows.length)}</Badge>
      </CardHeader>
      <CardBody>
        {pending.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : pending.error ? (
          <ErrorCard message={errorMessage(pending.error)} onRetry={() => void pending.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={WalletCards}
            title="رسیدی در انتظار تأیید نیست"
            description="رسیدهای کارت به کارتِ کاربران پس از ثبت، اینجا برای تأیید یا رد نمایش داده می‌شوند."
          />
        ) : (
          <Table caption="پرداخت‌های کارت به کارت در انتظار تأیید">
            <THead>
              <TR>
                <TH>#</TH>
                <TH>کاربر</TH>
                <TH>مبلغ</TH>
                <TH>هدف</TH>
                <TH>شماره پیگیری</TH>
                <TH>تاریخ</TH>
                <TH>عملیات</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((p) => (
                <TR key={String(p.id)}>
                  <TD className="text-xs text-neutral-400">{toFaSafe(p.id)}</TD>
                  <TD className="max-w-44 truncate text-xs text-neutral-600" title={p.userEmail ?? undefined}>
                    {p.userEmail || `کاربر #${String(p.userId ?? '—')}`}
                  </TD>
                  <TD className="font-medium text-neutral-900">{faMoney(p.amount ?? 0)}</TD>
                  <TD className="text-xs">{labelOf(paymentPurposeLabels, p.purpose)}</TD>
                  <TD dir="ltr" className="max-w-32 truncate text-xs text-neutral-600">
                    {p.reference || '—'}
                  </TD>
                  <TD className="text-xs text-neutral-500">{faDateTime(p.createdAt)}</TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        loading={approveMutation.isPending && String(approveMutation.variables) === String(p.id)}
                        disabled={approveMutation.isPending || rejectMutation.isPending}
                        onClick={() => approveMutation.mutate(p.id)}
                      >
                        <Check aria-hidden="true" className="size-4" />
                        تأیید
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={approveMutation.isPending || rejectMutation.isPending}
                        onClick={() => {
                          setRejectTarget(p);
                          setRejectReason('');
                        }}
                      >
                        <X aria-hidden="true" className="size-4" />
                        رد
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <p className="mt-3 text-xs leading-6 text-neutral-400">
          تأیید، همان اثر پرداخت موفق درگاه را یک‌بار اجرا می‌کند (فعال‌سازی پلن یا شارژ کیف پول) و کاربر با اعلان مطلع می‌شود؛ ردِ رسید نیز برای کاربر اعلان دارد.
        </p>
      </CardBody>

      {/* reject dialog */}
      <Dialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        title={`رد پرداخت #${toFaSafe(rejectTarget?.id)}`}
        description="در صورت نیاز دلیل رد را وارد کنید؛ به کاربر اطلاع داده می‌شود."
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <Badge tone="warning">{labelOf(paymentStatusLabels, rejectTarget?.status)}</Badge>
            <span>مبلغ: {faMoney(rejectTarget?.amount ?? 0)}</span>
            <span>پیگیری: {rejectTarget?.reference || '—'}</span>
          </div>
          <Textarea
            label="دلیل رد (اختیاری)"
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            hint="مثلاً: مبلغ واریز با فاکتور مطابقت ندارد."
          />
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              loading={rejectMutation.isPending}
              onClick={() => rejectTarget !== null && rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason })}
            >
              رد پرداخت
            </Button>
            <Button variant="ghost" onClick={() => setRejectTarget(null)} disabled={rejectMutation.isPending}>
              انصراف
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

/** Persian digits for ids (safe on strings/numbers). */
function toFaSafe(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return faNumber(Number(value), { group: false });
}

export default function AdminPage() {
  usePageTitle('داشبورد مدیریت');

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => get<AdminStats>('/admin/stats'),
  });

  return (
    <>
      <PageHeader
        title="داشبورد مدیریت"
        description="نمای کلی وضعیت پلتفرم"
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-800">
            <Shield aria-hidden="true" className="size-3.5" />
            دسترسی مدیر
          </span>
        }
      />

      <div className="space-y-6">
        {stats.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Stat
                key={i}
                label="…"
                value={<span className="inline-block h-7 w-16 animate-pulse rounded bg-neutral-200" />}
              />
            ))}
          </div>
        ) : stats.error ? (
          <ErrorCard message={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="کاربران" value={faNumber(stats.data?.users ?? 0)} icon={Users} />
            <Stat label="اشتراک فعال" value={faNumber(stats.data?.activeSubscriptions ?? 0)} icon={CreditCard} />
            <Stat
              label="درآمد ماه جاری"
              value={faMoney(stats.data?.paymentsVerifiedMonthTotal ?? 0)}
              icon={CreditCard}
              hint="مجموع پرداخت‌های تأییدشده"
            />
            <Stat label="ارسال ۳۰ روزه" value={faNumber(stats.data?.deliveriesSent30d ?? 0)} icon={Send} />
            <Stat label="تیکت باز" value={faNumber(stats.data?.openTickets ?? 0)} icon={LifeBuoy} hint="باز + در انتظار کاربر" />
          </div>
        )}

        {/* Quick links to sub-pages */}
        <section aria-label="دسترسی سریع مدیریتی">
          <h2 className="mb-3 text-base font-semibold text-neutral-900">مدیریت</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="focus-ring flex items-center gap-3 rounded-card border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
                  <link.icon aria-hidden="true" className="size-5 text-primary-700" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-neutral-900">{link.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">{link.description}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Task 10-d: payment gateways + card-to-card management */}
        <PaymentSettingsCard />
        <CardPaymentsCard />
      </div>
    </>
  );
}
