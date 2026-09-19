import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, PageLoading, Pagination, StatCard, StatusBadge } from '../../components/ui';
import { faDateTime, faMoney, faNumber, toLatinDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';

const ENTRY_KIND_FA: Record<string, string> = {
  CREDIT: 'واریز',
  DEBIT: 'برداشت',
  REFUND: 'بازگشت وجه',
  BONUS: 'هدیه',
  PAYMENT: 'پرداخت',
  ADJUSTMENT: 'اصلاح',
};

const CREDIT_KINDS = new Set(['CREDIT', 'REFUND', 'BONUS']);

const PAYMENT_STATE_FA: Record<string, string> = {
  CREATED: 'ایجادشده',
  REDIRECTED: 'هدایت به درگاه',
  VERIFIED: 'تأییدشده',
  FAILED: 'ناموفق',
  CANCELLED: 'لغوشده',
  REFUNDED: 'بازگشت‌شده',
};

const PURPOSE_FA: Record<string, string> = {
  SUBSCRIPTION: 'اشتراک',
  WALLET_TOPUP: 'شارژ کیف پول',
};

interface LedgerRow {
  id: string;
  entryKind?: string;
  amountRial?: number;
  balanceAfter?: number;
  memoFa?: string | null;
  createdAt?: string | null;
}

interface PaymentRow {
  id: string;
  purpose?: string | null;
  amountRial?: number;
  state?: string | null;
  createdAt?: string | null;
}

export default function Wallet() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);

  const [balanceRial, setBalanceRial] = useState(0);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);

  const [topupAmount, setTopupAmount] = useState('');
  const [topupBusy, setTopupBusy] = useState(false);
  const [convertAmount, setConvertAmount] = useState('');
  const [convertBusy, setConvertBusy] = useState(false);

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsLoading, setPaymentsLoading] = useState(true);

  const loadWallet = useCallback(async () => {
    const d = await api.get<{ balanceRial?: number; pointsBalance?: number; ledger?: LedgerRow[]; transactions?: LedgerRow[] }>('/api/v1/wallet');
    setBalanceRial(Number(d.balanceRial ?? 0));
    setPointsBalance(Number(d.pointsBalance ?? 0));
    setLedger(d.ledger ?? d.transactions ?? []);
  }, []);

  const loadPayments = useCallback(async (page: number) => {
    setPaymentsLoading(true);
    try {
      const d = await api.get<{ items?: PaymentRow[]; total?: number; page?: number }>(`/api/v1/payments?page=${page}`);
      setPayments(d.items ?? []);
      setPaymentsTotal(Number(d.total ?? 0));
      setPaymentsPage(Number(d.page ?? page));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت تاریخچهٔ پرداخت‌ها ناموفق بود.');
    } finally {
      setPaymentsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      try {
        await loadWallet();
      } catch (err) {
        toast.error(err instanceof ApiRequestError ? err.message : 'دریافت موجودی کیف پول ناموفق بود.');
      } finally {
        setLoading(false);
      }
    })();
    void loadPayments(1);
  }, [loadWallet, loadPayments, toast]);

  const signedMoney = (kind: string | undefined, amount: number | undefined): string => {
    const a = Number(amount ?? 0);
    const sign = CREDIT_KINDS.has(kind ?? '') ? '+' : '−';
    return `${sign}${faMoney(Math.abs(a))}`;
  };

  const parseAmount = (input: string): number => {
    const digits = toLatinDigits(input).replace(/[^\d]/g, '');
    const n = Number(digits);
    return Number.isFinite(n) ? n : NaN;
  };

  const submitTopup = async () => {
    const toman = parseAmount(topupAmount);
    if (!Number.isInteger(toman) || toman < 10000) {
      toast.error('حداقل مبلغ شارژ ۱۰٬۰۰۰ تومان است.');
      return;
    }
    setTopupBusy(true);
    try {
      const d = await api.post<{ redirectUrl?: string }>('/api/v1/payments/wallet-topup', { amountRial: toman * 10 });
      if (d.redirectUrl) {
        window.location.href = d.redirectUrl;
        return;
      }
      toast.error('درگاه پرداخت در دسترس نیست؛ کمی بعد دوباره تلاش کنید.');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ایجاد درخواست شارژ ناموفق بود.');
    } finally {
      setTopupBusy(false);
    }
  };

  const submitConvert = async () => {
    const points = parseAmount(convertAmount);
    if (!Number.isInteger(points) || points < 100) {
      toast.error('حداقل امتیاز قابل تبدیل ۱۰۰ امتیاز است.');
      return;
    }
    if (points > pointsBalance) {
      toast.error('امتیاز شما کافی نیست.');
      return;
    }
    setConvertBusy(true);
    try {
      const d = await api.post<{ amountRial?: number; pointsRemaining?: number }>('/api/v1/wallet/convert-points', { points });
      toast.success(`${faMoney(d.amountRial ?? points * 10)} به موجودی کیف پول شما اضافه شد.`);
      setConvertAmount('');
      await loadWallet();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'تبدیل امتیاز ناموفق بود.');
    } finally {
      setConvertBusy(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 21, fontWeight: 800 }}>کیف پول</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>شارژ حساب، تبدیل امتیاز و پیگیری تراکنش‌ها.</p>
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', marginBottom: 20 }}>
        <StatCard icon="💰" bg="var(--success-soft)" value={faMoney(balanceRial)} label="موجودی کیف پول" />
        <StatCard icon="🎯" bg="var(--brand-soft)" value={faNumber(pointsBalance)} label="امتیاز فعلی" />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginBottom: 24 }}>
        <Card>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>شارژ کیف پول</h2>
          <Field label="مبلغ (تومان)" required hint="حداقل ۱۰٬۰۰۰ تومان؛ پس از ثبت، به درگاه بانکی هدایت می‌شوید.">
            <Input inputMode="numeric" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} placeholder="مثلاً ۲۰۰٬۰۰۰" />
          </Field>
          <Button onClick={() => void submitTopup()} loading={topupBusy}>پرداخت و شارژ</Button>
        </Card>

        <Card>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>تبدیل امتیاز به موجودی</h2>
          <Field label="تعداد امتیاز" required hint="هر ۱۰ امتیاز = ۱۰ تومان؛ حداقل تبدیل ۱۰۰ امتیاز.">
            <Input inputMode="numeric" value={convertAmount} onChange={(e) => setConvertAmount(e.target.value)} placeholder="مثلاً ۱۰۰" />
          </Field>
          <Button variant="soft" onClick={() => void submitConvert()} loading={convertBusy}>تبدیل امتیاز</Button>
        </Card>
      </div>

      <h2 style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>گردش حساب (۲۰ تراکنش اخیر)</h2>
      <Card>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>نوع</th>
                <th>مبلغ</th>
                <th>موجودی پس از تراکنش</th>
                <th>شرح</th>
                <th>زمان</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-2)' }}>تراکنشی ثبت نشده است.</td>
                </tr>
              ) : (
                ledger.map((row) => (
                  <tr key={row.id}>
                    <td><span className="badge badge-info">{ENTRY_KIND_FA[row.entryKind ?? ''] ?? row.entryKind}</span></td>
                    <td style={{ fontWeight: 700, color: CREDIT_KINDS.has(row.entryKind ?? '') ? 'var(--success)' : 'var(--danger)' }}>
                      {signedMoney(row.entryKind, row.amountRial)}
                    </td>
                    <td>{faMoney(row.balanceAfter)}</td>
                    <td>{row.memoFa || '—'}</td>
                    <td>{faDateTime(row.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <h2 style={{ fontSize: 17, fontWeight: 800, margin: '26px 0 12px' }}>تاریخچهٔ پرداخت‌ها</h2>
      <Card>
        {paymentsLoading ? (
          <PageLoading />
        ) : payments.length === 0 ? (
          <EmptyState icon="🧾" title="پرداختی ثبت نشده است" description="پس از اولین خرید یا شارژ، رسید اینجا نمایش داده می‌شود." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>بابت</th>
                    <th>مبلغ</th>
                    <th>وضعیت</th>
                    <th>زمان</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{PURPOSE_FA[p.purpose ?? ''] ?? p.purpose}</td>
                      <td style={{ fontWeight: 700 }}>{faMoney(p.amountRial)}</td>
                      <td><StatusBadge state={p.state ?? ''} labels={PAYMENT_STATE_FA} /></td>
                      <td>{faDateTime(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={paymentsPage} pageSize={20} total={paymentsTotal} onPage={(p) => void loadPayments(p)} />
          </>
        )}
      </Card>
    </div>
  );
}
