import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  PageLoading,
  Pagination,
  StatusBadge,
  Textarea,
} from '../../components/ui';
import { faDateTime, faFileSize, faNumber, faRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import {
  PAGE_SIZE,
  TICKET_STATE_FA,
  errText,
  strField,
} from './shared';

/* ------------------------------------------------------------------ */
/* تیکت‌های پشتیبانی — admin conversation view (round 18-c).           */
/* List with state chips + debounced search, conversation modal with   */
/* reply (POST messages) and close (POST close). Backend contract:     */
/*   GET  /admin/support/tickets?page&pageSize&state&search            */
/*   GET  /admin/support/tickets/:id                                   */
/*   POST /admin/support/tickets/:id/messages { body }                 */
/*   POST /admin/support/tickets/:id/close                             */
/* ------------------------------------------------------------------ */

interface AdminTicketRow {
  id: string;
  subject?: string | null;
  category?: string | null;
  state?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantEmail?: string | null;
  messageCount?: number | null;
  lastMessageAt?: string | null;
}

interface TicketAttachment {
  id: string;
  fileName: string;
  size: number;
  mime: string;
  url: string;
}

interface TicketMessage {
  id: string;
  authorRole?: string | null;
  authorId?: string | null;
  body?: string | null;
  createdAt?: string | null;
  attachment?: TicketAttachment | null;
}

const CATEGORY_FALLBACK: Record<string, string> = {
  GENERAL: 'عمومی',
  BILLING: 'مالی',
  TECHNICAL: 'فنی',
  FEATURE: 'درخواست امکان',
  BOT: 'ربات و پاسخگوی خودکار',
};

const AUTHOR_ROLE_FA: Record<string, string> = {
  USER: 'کاربر',
  SUPPORT: 'پشتیبانی',
  SUPER_ADMIN: 'مدیر',
  SYSTEM: 'سیستم',
};

const STATE_FILTERS: Array<{ key: string; label: string }> = [
  { key: '', label: 'همه' },
  { key: 'OPEN', label: TICKET_STATE_FA.OPEN },
  { key: 'ANSWERED', label: TICKET_STATE_FA.ANSWERED },
  { key: 'CLOSED', label: TICKET_STATE_FA.CLOSED },
];

export default function AdminTickets() {
  const toast = useToast();

  const [items, setItems] = useState<AdminTicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Record<string, string>>({});

  // per-state totals for the chips (cheap: pageSize=1, no search)
  const [counts, setCounts] = useState<Record<string, number>>({ OPEN: 0, ANSWERED: 0, CLOSED: 0 });

  // conversation modal
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTicket, setDetailTicket] = useState<AdminTicketRow | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const loadList = useCallback(
    async (p: number, st: string, term: string) => {
      setLoading(true);
      try {
        const q = new URLSearchParams();
        q.set('page', String(p));
        q.set('pageSize', String(PAGE_SIZE));
        if (st) q.set('state', st);
        if (term) q.set('search', term);
        const d = await api.get<{
          items?: AdminTicketRow[];
          total?: number;
          page?: number;
          categories?: Array<{ key: string; labelFa: string }>;
        }>(`/api/v1/admin/support/tickets?${q.toString()}`);
        setItems(d.items ?? []);
        setTotal(Number(d.total ?? 0));
        setPage(Number(d.page ?? p));
        if (Array.isArray(d.categories) && d.categories.length > 0) {
          const map: Record<string, string> = { ...CATEGORY_FALLBACK };
          for (const c of d.categories) map[c.key] = strField(c.labelFa, map[c.key] ?? c.key);
          setCategories(map);
        }
      } catch (err) {
        toast.error(errText(err, 'دریافت تیکت‌ها ناموفق بود.'));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Chip counts: one tiny request per state (pageSize=1, no search). */
  const loadCounts = useCallback(async () => {
    const states = ['OPEN', 'ANSWERED', 'CLOSED'];
    const results = await Promise.allSettled(
      states.map((s) =>
        api.get<{ total?: number }>(`/api/v1/admin/support/tickets?page=1&pageSize=1&state=${s}`)
      )
    );
    const next: Record<string, number> = {};
    states.forEach((s, i) => {
      next[s] = results[i].status === 'fulfilled' ? Number(results[i].value.total ?? 0) : 0;
    });
    setCounts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // debounced search → reset to page 1
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    void loadList(page, state, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, state, search]);

  useEffect(() => {
    void loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = useCallback(
    async (p = page) => {
      await Promise.all([loadList(p, state, search), loadCounts()]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [loadList, loadCounts, page, state, search]
  );

  const openTicket = async (id: string) => {
    setOpenId(id);
    setDetailLoading(true);
    setReply('');
    try {
      const d = await api.get<{ ticket?: AdminTicketRow; messages?: TicketMessage[] }>(
        `/api/v1/admin/support/tickets/${id}`
      );
      setDetailTicket(d.ticket ?? null);
      setMessages(d.messages ?? []);
    } catch (err) {
      toast.error(errText(err, 'دریافت گفتگوی تیکت ناموفق بود.'));
      setOpenId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshTicket = useCallback(async (id: string) => {
    const d = await api.get<{ ticket?: AdminTicketRow; messages?: TicketMessage[] }>(
      `/api/v1/admin/support/tickets/${id}`
    );
    setDetailTicket(d.ticket ?? null);
    setMessages(d.messages ?? []);
  }, []);

  const sendReply = async () => {
    if (!openId || !reply.trim()) return;
    setReplying(true);
    try {
      await api.post(`/api/v1/admin/support/tickets/${openId}/messages`, { body: reply.trim() });
      setReply('');
      toast.success('پاسخ ثبت و برای کاربر ارسال شد.');
      await refreshTicket(openId);
      void refreshAll();
    } catch (err) {
      toast.error(errText(err, 'ارسال پاسخ ناموفق بود.'));
    } finally {
      setReplying(false);
    }
  };

  const closeTicket = async () => {
    if (!openId) return;
    setClosing(true);
    try {
      await api.post(`/api/v1/admin/support/tickets/${openId}/close`);
      toast.success('تیکت بسته شد.');
      setCloseOpen(false);
      await refreshTicket(openId);
      void refreshAll();
    } catch (err) {
      toast.error(errText(err, 'بستن تیکت ناموفق بود.'));
    } finally {
      setClosing(false);
    }
  };

  const ticketClosed = (detailTicket?.state ?? '') === 'CLOSED';

  return (
    <>
      <div className="adm-page-head">
        <h2>تیکت‌های پشتیبانی</h2>
        <p>گفتگو با کاربران، پاسخ و بستن تیکت‌ها</p>
      </div>

      <Card>
        <div className="adm-filters">
          <div className="adm-filters__chips" role="group" aria-label="فیلتر وضعیت تیکت">
            {STATE_FILTERS.map((f) => {
              const count = f.key === '' ? counts.OPEN + counts.ANSWERED + counts.CLOSED : counts[f.key];
              return (
                <button
                  key={f.key || 'all'}
                  type="button"
                  className={`adm-chip${state === f.key ? ' is-active' : ''}`}
                  onClick={() => {
                    setState(f.key);
                    setPage(1);
                  }}
                >
                  {f.label}
                  {count > 0 && <span className="adm-chip__count">{faNumber(count)}</span>}
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="جستجو: موضوع یا نام/ایمیل کاربر…"
              aria-label="جستجوی تیکت"
            />
          </div>
        </div>

        {loading ? (
          <PageLoading />
        ) : items.length === 0 ? (
          <EmptyState
            icon="🎫"
            title="تیکتی پیدا نشد"
            description="با تغییر وضعیت یا عبارت جستجو دوباره بررسی کنید."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table adm-table--cards">
                <thead>
                  <tr>
                    <th>موضوع</th>
                    <th>کاربر</th>
                    <th>دسته‌بندی</th>
                    <th>وضعیت</th>
                    <th>تعداد پیام</th>
                    <th>آخرین فعالیت</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id}>
                      <td data-label="موضوع" style={{ fontWeight: 700 }}>
                        {strField(t.subject) || '—'}
                      </td>
                      <td data-label="کاربر">
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{strField(t.tenantName) || '—'}</div>
                        {t.tenantEmail && (
                          <div dir="ltr" style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--text-2)' }}>
                            {t.tenantEmail}
                          </div>
                        )}
                      </td>
                      <td data-label="دسته‌بندی">{(categories[t.category ?? ''] ?? strField(t.category)) || '—'}</td>
                      <td data-label="وضعیت">
                        <StatusBadge state={t.state ?? ''} labels={TICKET_STATE_FA} />
                      </td>
                      <td data-label="تعداد پیام">{faNumber(Number(t.messageCount ?? 0))}</td>
                      <td data-label="آخرین فعالیت">{faRelative(t.lastMessageAt ?? t.updatedAt)}</td>
                      <td>
                        <Button size="sm" variant="soft" onClick={() => void openTicket(t.id)}>
                          مشاهده و پاسخ
                        </Button>
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

      <Modal open={openId !== null} onClose={() => setOpenId(null)} title={strField(detailTicket?.subject) || 'گفتگوی تیکت'} large>
        {detailLoading ? (
          <PageLoading />
        ) : (
          <>
            {/* conversation header: user + state + close action */}
            <div className="adm-ticket-head">
              <div className="adm-ticket-head__who">
                <strong>{strField(detailTicket?.tenantName) || 'کاربر'}</strong>
                {detailTicket?.tenantEmail && (
                  <span dir="ltr" style={{ textAlign: 'right' }}>
                    {detailTicket.tenantEmail}
                  </span>
                )}
              </div>
              <div className="adm-ticket-head__side">
                <StatusBadge state={detailTicket?.state ?? ''} labels={TICKET_STATE_FA} />
                {!ticketClosed && (
                  <Button size="sm" variant="ghost" onClick={() => setCloseOpen(true)}>
                    بستن تیکت
                  </Button>
                )}
              </div>
            </div>

            {ticketClosed && (
              <div className="adm-note adm-note--info" role="status" style={{ marginBottom: 12 }}>
                <span aria-hidden="true">ℹ️</span>
                <span>این تیکت بسته شده است.</span>
              </div>
            )}

            {/* messages thread (scrollable) */}
            <div className="adm-ticket-thread" aria-live="polite">
              {messages.length === 0 ? (
                <p className="adm-ticket-thread__empty">پیامی رد و بدل نشده است.</p>
              ) : (
                messages.map((m) => {
                  const staff = m.authorRole === 'SUPPORT' || m.authorRole === 'SUPER_ADMIN';
                  return (
                    <div key={m.id} className={`adm-ticket-msg${staff ? ' adm-ticket-msg--staff' : ''}`}>
                      <div className="adm-ticket-msg__meta">
                        <strong>{AUTHOR_ROLE_FA[m.authorRole ?? ''] ?? m.authorRole}</strong>
                        <span>{faDateTime(m.createdAt)}</span>
                      </div>
                      <div className="adm-ticket-msg__body">{strField(m.body)}</div>
                      {m.attachment && (
                        <a
                          className="adm-ticket-msg__attach"
                          href={m.attachment.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          پیوست: {strField(m.attachment.fileName) || 'فایل'} ({faFileSize(m.attachment.size)})
                        </a>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* reply form — hidden once the ticket is closed */}
            {!ticketClosed && (
              <div style={{ marginTop: 14 }}>
                <Field label="پاسخ مدیر" hint="پاسخ شما مستقیماً برای کاربر ارسال و تیکت به حالت «پاسخ داده‌شده» تغییر می‌کند.">
                  <Textarea
                    rows={4}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="متن پاسخ به کاربر…"
                    aria-label="متن پاسخ"
                  />
                </Field>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Button onClick={() => void sendReply()} loading={replying} disabled={!reply.trim()}>
                    ارسال پاسخ
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={() => void closeTicket()}
        title="بستن تیکت"
        message="با بستن تیکت، گفتگو پایان می‌یابد و کاربر دیگر نمی‌تواند پیام جدیدی ارسال کند. ادامه می‌دهید؟"
        danger
        busy={closing}
      />
    </>
  );
}
