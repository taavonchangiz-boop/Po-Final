import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Wallet as WalletIcon } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { get, post, ApiError } from '../../lib/api';
import { faMoney, faDateTime, faNumber, toEn, labelOf } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { errorMessage, ErrorCard } from '../publishing/parts';
import { walletTypeLabels, walletSignedAmount, openGatewayRedirect } from './billingParts';

/**
 * Wallet — balance, topup (gateway redirect) and the append-only ledger.
 * Shapes verified against app/src/modules/billing/billing.routes.ts +
 * wallet.service.ts + payment.service.ts:
 *  - GET /wallet → { balance, currency, entries: [{ id, direction, type, amount,
 *    balanceAfter, description, createdAt }] } (10 most recent entries).
 *  - GET /wallet/entries?page&limit → { items: WalletEntryRow[], total, page, limit }.
 *  - POST /wallet/topup { amount? } → 201 { paymentId, redirectUrl, amount, gateway,
 *    presets } — amount min 100,000 Rial (WALLET_TOPUP_MIN), max 500,000,000.
 *    Presets come from PaymentService: 100k / 500k / 1M / 2M / 5M Rial.
 */

interface WalletEntryRecord {
  id: number | string;
  direction?: 'CREDIT' | 'DEBIT' | string;
  type?: string;
  amount?: number;
  balanceAfter?: number;
  description?: string | null;
  createdAt?: string;
}

interface WalletResponse {
  balance?: number;
  currency?: string;
  entries?: WalletEntryRecord[];
}

const TOPUP_PRESETS = [100_000, 500_000, 1_000_000, 2_000_000, 5_000_000] as const;
const TOPUP_MIN = 100_000; // Rial — mirrors PaymentService.WALLET_TOPUP_MIN
const TOPUP_MAX = 500_000_000; // Rial — mirrors PaymentService.WALLET_TOPUP_MAX

export default function WalletPage() {
  usePageTitle('کیف پول');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [searchParams, setSearchParams] = useSearchParams();

  // Gateway browser-return flow: /app/wallet?payment=ok|failed (payment.service successRedirect).
  const paymentResult = searchParams.get('payment');
  useEffect(() => {
    if (paymentResult === 'ok') {
      pushToast('success', 'پرداخت با موفقیت تأیید و به موجودی کیف پول اضافه شد.');
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void setSearchParams({}, { replace: true });
    } else if (paymentResult === 'failed') {
      pushToast('error', 'پرداخت ناموفق بود یا تأیید نشد؛ اگر مبلغ کسر شده باشد به‌صورت خودکار بازگشت داده می‌شود.');
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentResult]);

  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: () => get<WalletResponse>('/wallet'),
  });

  const [topupOpen, setTopupOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);

  const topupMutation = useMutation({
    mutationFn: (rial: number) =>
      post<{ paymentId?: number; redirectUrl?: string | null; amount?: number; gateway?: string; presets?: number[] }>(
        '/wallet/topup',
        { amount: rial },
      ),
    onSuccess: (data) => {
      setTopupOpen(false);
      setAmount('');
      if (data?.redirectUrl) {
        pushToast('info', 'در حال انتقال به درگاه پرداخت…');
        openGatewayRedirect(data.redirectUrl);
        return;
      }
      pushToast('info', 'پرداخت ایجاد شد اما درگاه در دسترس نیست؛ بعداً تلاش کنید.');
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  function submitTopup() {
    setAmountError(null);
    const rial = Number(toEn(amount).replace(/[^\d]/g, ''));
    if (!Number.isInteger(rial) || rial < TOPUP_MIN) {
      setAmountError(`حداقل مبلغ شارژ ${faMoney(TOPUP_MIN)} است.`);
      return;
    }
    if (rial > TOPUP_MAX) {
      setAmountError('مبلغ واردشده بیش از حد مجاز است.');
      return;
    }
    topupMutation.mutate(rial);
  }

  const entries = usePaged<WalletEntryRecord>({
    queryKey: ['wallet', 'entries'],
    buildPath: (page, limit) => `/wallet/entries?page=${page}&limit=${limit}`,
  });

  return (
    <>
      <PageHeader
        title="کیف پول"
        description="موجودی و گردش اعتبار حساب شما"
        actions={
          <Button onClick={() => setTopupOpen(true)}>
            <Plus aria-hidden="true" className="size-4" />
            افزایش اعتبار
          </Button>
        }
      />

      <div className="space-y-6">
        {wallet.isLoading ? (
          <Card className="p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-40" />
          </Card>
        ) : wallet.error ? (
          <ErrorCard message={errorMessage(wallet.error)} onRetry={() => void wallet.refetch()} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Stat
              label="موجودی فعلی"
              value={faMoney(wallet.data?.balance ?? 0)}
              icon={WalletIcon}
              hint="اعتبار برای خدمات پُستیار (ریال)"
            />
            {/* Latest entries preview lives in the ledger table below; balance card is the KPI. */}
          </div>
        )}

        {/* --------------------------------- ledger --------------------------------- */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-neutral-900">گردش حساب</h2>
          {entries.isLoading ? (
            <Card>
              <CardBody className="space-y-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </CardBody>
            </Card>
          ) : entries.error ? (
            <ErrorCard message={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />
          ) : entries.items.length === 0 ? (
            <EmptyState
              icon={WalletIcon}
              title="هنوز تراکنشی ثبت نشده است"
              description="با شارژ کیف پول یا دریافت پاداش معرفی، گردش حساب اینجا نمایش داده می‌شود."
              action={
                <Button onClick={() => setTopupOpen(true)}>
                  <Plus aria-hidden="true" className="size-4" />
                  افزایش اعتبار
                </Button>
              }
            />
          ) : (
            <>
              <Table caption="گردش حساب کیف پول">
                <THead>
                  <TR>
                    <TH>نوع</TH>
                    <TH>مبلغ</TH>
                    <TH>موجودی پس از</TH>
                    <TH>توضیحات</TH>
                    <TH>زمان</TH>
                  </TR>
                </THead>
                <TBody>
                  {entries.items.map((entry) => {
                    const isDebit = entry.direction === 'DEBIT';
                    return (
                      <TR key={String(entry.id)}>
                        <TD>
                          <span className="font-medium text-neutral-900">{labelOf(walletTypeLabels, entry.type)}</span>
                        </TD>
                        <TD>
                          <span className={isDebit ? 'font-medium text-red-700' : 'font-medium text-green-700'}>
                            {walletSignedAmount(entry.direction, entry.amount)}
                          </span>
                        </TD>
                        <TD>{faMoney(entry.balanceAfter ?? 0)}</TD>
                        <TD className="max-w-64 truncate text-xs text-neutral-500" title={entry.description ?? undefined}>
                          {entry.description || '—'}
                        </TD>
                        <TD className="text-xs text-neutral-500">{faDateTime(entry.createdAt)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
              <Pagination className="mt-4" page={entries.page} totalPages={entries.totalPages} onChange={entries.setPage} />
            </>
          )}
        </div>
      </div>

      {/* ------------------------------- topup dialog ------------------------------- */}
      <Dialog
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        title="افزایش اعتبار کیف پول"
        description="مبلغ شارژ به ریال؛ پس از پرداخت در درگاه، به‌صورت خودکار به موجودی اضافه می‌شود."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TOPUP_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setAmount(String(preset));
                  setAmountError(null);
                }}
                aria-pressed={toEn(amount).replace(/[^\d]/g, '') === String(preset)}
                className={
                  'focus-ring rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ' +
                  (toEn(amount).replace(/[^\d]/g, '') === String(preset)
                    ? 'border-primary-600 bg-primary-50 text-primary-800'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300')
                }
              >
                {faNumber(preset, { group: true })} ریال
              </button>
            ))}
          </div>
          <Input
            label="مبلغ دلخواه (ریال)"
            dir="ltr"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={amountError ?? undefined}
            hint={`حداقل ${faMoney(TOPUP_MIN)}`}
          />
          <div className="flex items-center gap-2 pt-1">
            <Button loading={topupMutation.isPending} onClick={submitTopup}>
              پرداخت و انتقال به درگاه
            </Button>
            <Button variant="ghost" onClick={() => setTopupOpen(false)} disabled={topupMutation.isPending}>
              انصراف
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
