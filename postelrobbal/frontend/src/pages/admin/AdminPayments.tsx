import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, Field, Modal, PageLoading, Pagination, Select, StatusBadge, Textarea } from '../../components/ui';
import { faDateTime, faMoney } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { PAGE_SIZE, PAYMENT_STATE_FA, errText, type AdminPaymentRow } from './shared';

/* ------------------------------------------------------------------ */
/* پرداخت‌ها — status filter + approve/review receipt flows.           */
/* Harvested from the old single-page admin (Task 16-b).               */
/* ------------------------------------------------------------------ */

function purposeFa(purpose?: string | null): string {
  if (purpose === 'SUBSCRIPTION') return 'اشتراک';
  if (purpose === 'WALLET_TOPUP') return 'شارژ کیف پول';
  return purpose || '—';
}

export default function AdminPayments() {
  const toast = useToast();

  const [items, setItems] = useState<AdminPaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  // approve (send {} — idempotent settle on the server)
  const [approveId, setApproveId] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);

  // reject receipt with a required reason
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);

  const loadPayments = async (p: number, state: string) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('page', String(p));
      q.set('pageSize', String(PAGE_SIZE));
      if (state) q.set('status', state);
      const d = await api.get<{ items?: AdminPaymentRow[]; total?: number; page?: number }>(`/api/v1/admin/payments?${q.toString()}`);
      setItems(d.items ?? []);
      setTotal(Number(d.total ?? 0));
      const pages = Math.ceil(Number(d.total ?? 0) / PAGE_SIZE);
      if (pages > 0 && p > pages) setPage(pages);
    } catch (err) {
      toast.error(errText(err, 'دریافت پرداخت‌ها ناموفق بود.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPayments(page, status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  const approveTarget = items.find((p) => p.id === approveId);

  const approvePayment = async () => {
    if (!approveId) return;
    setApproveBusy(true);
    try {
      await api.post(`/api/v1/admin/payments/${approveId}/approve`, {});
      toast.success('پرداخت تأیید و اعمال شد.');
      setApproveId(null);
      await loadPayments(page, status);
    } catch (err) {
      toast.error(errText(err, 'تأیید پرداخت ناموفق بود.'));
    } finally {
      setApproveBusy(false);
    }
  };

  const rejectPayment = async () => {
    if (!rejectId) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      toast.error('دلیل رد را بنویسید (حداقل ۳ نویسه).');
      return;
    }
    setRejectBusy(true);
    try {
      await api.post(`/api/v1/admin/payments/${rejectId}/reject`, { reason });
      toast.success('پرداخت رد شد.');
      setRejectId(null);
      setRejectReason('');
      await loadPayments(page, status);
    } catch (err) {
      toast.error(errText(err, 'رد پرداخت ناموفق بود.'));
    } finally {
      setRejectBusy(false);
    }
  };

  return (
    <>
      <div className="adm-page-head">
        <h2>پرداخت‌ها</h2>
        <p>بررسی و تأیید پرداخت‌های آنلاین و رسیدهای کارت به کارت</p>
      </div>

      <Card>
        <div className="adm-toolbar">
          <div style={{ minWidth: 220 }}>
            <Select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              aria-label="فیلتر وضعیت پرداخت"
            >
              <option value="">همهٔ وضعیت‌ها</option>
              {Object.entries(PAYMENT_STATE_FA).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
          </div>
        </div>

        {loading ? (
          <PageLoading />
        ) : items.length === 0 ? (
          <EmptyState icon="💳" title="پرداختی یافت نشد" description="با تغییر فیلتر وضعیت، دوباره جستجو کنید." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>مبلغ</th>
                    <th>وضعیت</th>
                    <th>بابت</th>
                    <th>کاربر</th>
                    <th>زمان</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 700 }}>{faMoney(p.amountRial)}</td>
                      <td><StatusBadge state={p.state ?? ''} labels={PAYMENT_STATE_FA} /></td>
                      <td>{purposeFa(p.purpose)}</td>
                      <td dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{p.userEmail || (p.tenantId ? p.tenantId.slice(0, 10) : '—')}</td>
                      <td>{faDateTime(p.createdAt)}</td>
                      <td>
                        <div className="adm-table-actions">
                          {(p.state === 'CREATED' || p.state === 'PENDING_REVIEW') && (
                            <Button size="sm" variant="soft" onClick={() => setApproveId(p.id)}>تأیید</Button>
                          )}
                          {p.state === 'PENDING_REVIEW' && (
                            <Button size="sm" variant="ghost" onClick={() => { setRejectId(p.id); setRejectReason(''); }}>رد رسید</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setPage(p)} />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={approveId !== null}
        onClose={() => setApproveId(null)}
        onConfirm={() => void approvePayment()}
        title="تأیید پرداخت"
        message={`تأیید پرداخت ${faMoney(approveTarget?.amountRial)} باعث فعال‌سازی اشتراک یا شارژ کیف پول کاربر می‌شود. ادامه می‌دهید؟`}
        danger
        busy={approveBusy}
      />

      <Modal open={rejectId !== null} onClose={() => setRejectId(null)} title="رد رسید پرداخت">
        <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 14 }}>
          دلیل رد برای کاربر ارسال می‌شود؛ پس از رد، پرداخت قابل بررسی مجدد نیست.
        </p>
        <Field label="دلیل رد" required hint="مثلاً: مبلغ رسید با فاکتور مطابقت ندارد یا تصویر ناخوانا است.">
          <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="دلیل رد رسید…" />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="danger" loading={rejectBusy} disabled={rejectReason.trim().length < 3} onClick={() => void rejectPayment()}>
            رد پرداخت
          </Button>
          <Button variant="ghost" onClick={() => setRejectId(null)}>انصراف</Button>
        </div>
      </Modal>
    </>
  );
}
