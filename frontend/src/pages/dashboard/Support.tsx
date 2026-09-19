import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageLoading, Pagination, Select, StatusBadge, Textarea } from '../../components/ui';
import { TICKET_STATE_FA, faDateTime, faRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';

const CATEGORY_FA: Record<string, string> = {
  GENERAL: 'عمومی',
  BILLING: 'مالی',
  TECHNICAL: 'فنی',
  FEATURE: 'درخواست امکان',
  BOT: 'ربات و پاسخگوی خودکار',
};

const AUTHOR_ROLE_FA: Record<string, string> = {
  USER: 'شما',
  SUPPORT: 'پشتیبانی',
  SUPER_ADMIN: 'مدیر',
  SYSTEM: 'سیستم',
};

interface TicketRow {
  id: string;
  subject?: string | null;
  category?: string | null;
  state?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface TicketMessage {
  id: string;
  authorRole?: string | null;
  authorId?: string | null;
  body?: string | null;
  createdAt?: string | null;
}

export default function Support() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<Array<{ key: string; labelFa: string }>>(Object.entries(CATEGORY_FA).map(([key, labelFa]) => ({ key, labelFa })));

  const [newOpen, setNewOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [body, setBody] = useState('');
  const [creating, setCreating] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTicket, setDetailTicket] = useState<TicketRow | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const d = await api.get<{ items?: TicketRow[]; total?: number; page?: number; categories?: Array<{ key: string; labelFa: string }> }>(`/api/v1/support/tickets?page=${p}`);
      setItems(d.items ?? []);
      setTotal(Number(d.total ?? 0));
      setPage(Number(d.page ?? p));
      if (Array.isArray(d.categories) && d.categories.length > 0) setCategories(d.categories);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت تیکت‌ها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load(1);
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    setReply('');
    try {
      const d = await api.get<{ ticket?: TicketRow; messages?: TicketMessage[] }>(`/api/v1/support/tickets/${id}`);
      setDetailTicket(d.ticket ?? null);
      setMessages(d.messages ?? []);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت جزئیات تیکت ناموفق بود.');
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = useCallback(async (id: string) => {
    const d = await api.get<{ ticket?: TicketRow; messages?: TicketMessage[] }>(`/api/v1/support/tickets/${id}`);
    setDetailTicket(d.ticket ?? null);
    setMessages(d.messages ?? []);
  }, []);

  const createTicket = async () => {
    if (subject.trim().length < 3) {
      toast.error('موضوع تیکت را کامل وارد کنید.');
      return;
    }
    if (body.trim().length < 5) {
      toast.error('متن تیکت را کامل وارد کنید.');
      return;
    }
    setCreating(true);
    try {
      await api.post('/api/v1/support/tickets', { subject: subject.trim(), category, body: body.trim() });
      toast.success('تیکت شما ثبت شد؛ به‌زودی پاسخ می‌دهیم.');
      setNewOpen(false);
      setSubject('');
      setBody('');
      setCategory('GENERAL');
      await load(1);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ثبت تیکت ناموفق بود.');
    } finally {
      setCreating(false);
    }
  };

  const sendReply = async () => {
    if (!detailId || !reply.trim()) return;
    setReplying(true);
    try {
      await api.post(`/api/v1/support/tickets/${detailId}/messages`, { body: reply.trim() });
      setReply('');
      await refreshDetail(detailId);
      toast.success('پاسخ شما ثبت شد.');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ارسال پاسخ ناموفق بود.');
    } finally {
      setReplying(false);
    }
  };

  const closeTicket = async () => {
    if (!detailId) return;
    setBusy(true);
    try {
      await api.post(`/api/v1/support/tickets/${detailId}/close`);
      toast.success('تیکت بسته شد.');
      setCloseOpen(false);
      await Promise.all([refreshDetail(detailId), load(page)]);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'بستن تیکت ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800 }}>پشتیبانی و تیکت‌ها</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>سؤال یا مشکل خود را ثبت کنید؛ تیم پشتیبانی پاسخ می‌دهد.</p>
        </div>
        <Button onClick={() => setNewOpen(true)}>+ تیکت جدید</Button>
      </div>

      {loading ? (
        <PageLoading />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🎫"
          title="تیکتی ثبت نکرده‌اید"
          description="هر سؤال یا مشکلی دربارهٔ حساب، پرداخت یا ارسال پیام دارید، از اینجا بپرسید."
          action={<Button onClick={() => setNewOpen(true)}>ثبت اولین تیکت</Button>}
        />
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>موضوع</th>
                  <th>دسته</th>
                  <th>وضعیت</th>
                  <th>آخرین به‌روزرسانی</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 700 }}>{t.subject || '—'}</td>
                    <td>{CATEGORY_FA[t.category ?? ''] ?? t.category}</td>
                    <td><StatusBadge state={t.state ?? ''} labels={TICKET_STATE_FA} /></td>
                    <td>{faRelative(t.updatedAt)}</td>
                    <td><Button size="sm" variant="soft" onClick={() => void openDetail(t.id)}>مشاهده گفتگو</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={20} total={total} onPage={(p) => void load(p)} />
        </Card>
      )}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="ثبت تیکت جدید" large>
        <Field label="موضوع" required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="خلاصهٔ موضوع در یک جمله" />
        </Field>
        <Field label="دسته" required>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>{c.labelFa}</option>
            ))}
          </Select>
        </Field>
        <Field label="متن تیکت" required hint="توضیح کامل بدهید تا سریع‌تر پاسخ بگیرید؛ در صورت خطای ارسال، متن خطا را هم بنویسید.">
          <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button onClick={() => void createTicket()} loading={creating}>ثبت تیکت</Button>
          <Button variant="ghost" onClick={() => setNewOpen(false)}>انصراف</Button>
        </div>
      </Modal>

      <Modal open={Boolean(detailId)} onClose={() => setDetailId(null)} title={detailTicket?.subject ?? 'گفتگوی تیکت'} large>
        {detailLoading ? (
          <PageLoading />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
              <StatusBadge state={detailTicket?.state ?? ''} labels={TICKET_STATE_FA} />
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{CATEGORY_FA[detailTicket?.category ?? ''] ?? detailTicket?.category}</span>
              <div style={{ flex: 1 }} />
              {(detailTicket?.state ?? '') !== 'CLOSED' && (
                <Button size="sm" variant="ghost" onClick={() => setCloseOpen(true)}>بستن تیکت</Button>
              )}
            </div>

            <div style={{ display: 'grid', gap: 10, maxHeight: 380, overflowY: 'auto', marginBottom: 14 }}>
              {messages.length === 0 ? (
                <p style={{ color: 'var(--text-2)', fontSize: 13, textAlign: 'center' }}>پیامی رد و بدل نشده است.</p>
              ) : (
                messages.map((m) => {
                  const isUser = m.authorRole === 'USER';
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isUser ? 'flex-start' : 'flex-end',
                        maxWidth: '85%',
                        background: isUser ? 'var(--brand-soft)' : 'var(--surface-2)',
                        borderRadius: 12,
                        padding: '10px 14px',
                        border: `1px solid ${isUser ? 'var(--brand)' : 'var(--border)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--text-2)', marginBottom: 4, flexWrap: 'wrap' }}>
                        <strong>{AUTHOR_ROLE_FA[m.authorRole ?? ''] ?? m.authorRole}</strong>
                        <span>{faDateTime(m.createdAt)}</span>
                      </div>
                      <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                    </div>
                  );
                })
              )}
            </div>

            {(detailTicket?.state ?? '') !== 'CLOSED' && (
              <>
                <Field label="پاسخ شما">
                  <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="پاسخ یا توضیح تکمیلی…" />
                </Field>
                <Button onClick={() => void sendReply()} loading={replying} disabled={!reply.trim()}>ارسال پاسخ</Button>
              </>
            )}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={() => void closeTicket()}
        title="بستن تیکت"
        message="با بستن تیکت، گفتگو پایان می‌یابد و امکان ارسال پیام جدید وجود نخواهد داشت. ادامه می‌دهید؟"
        danger
        busy={busy}
      />
    </div>
  );
}
