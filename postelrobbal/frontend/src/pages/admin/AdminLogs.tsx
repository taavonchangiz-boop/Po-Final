import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Card, EmptyState, Input, PageLoading, Pagination } from '../../components/ui';
import { faDateTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { AUDIT_ACTION_FA, PAGE_SIZE, ROLE_FA, errText, type AuditRow } from './shared';

/* ------------------------------------------------------------------ */
/* گزارش رویداد — audit trail with action filter (Task 16-b).          */
/* ------------------------------------------------------------------ */

export default function AdminLogs() {
  const toast = useToast();

  const [items, setItems] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLogs = async (p: number, act: string) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('page', String(p));
      q.set('pageSize', String(PAGE_SIZE));
      if (act) q.set('action', act);
      const d = await api.get<{ items?: AuditRow[]; total?: number; page?: number }>(`/api/v1/admin/audit-logs?${q.toString()}`);
      setItems(d.items ?? []);
      setTotal(Number(d.total ?? 0));
      const pages = Math.ceil(Number(d.total ?? 0) / PAGE_SIZE);
      if (pages > 0 && p > pages) setPage(pages);
    } catch (err) {
      toast.error(errText(err, 'دریافت گزارش رویداد ناموفق بود.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => { setAction(actionInput.trim()); setPage(1); }, 400);
    return () => window.clearTimeout(t);
  }, [actionInput]);

  useEffect(() => {
    void loadLogs(page, action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, action]);

  return (
    <>
      <div className="adm-page-head">
        <h2>گزارش رویداد</h2>
        <p>تمام فعالیت‌های حساس کاربران و مدیران به‌صورت زمان‌دار</p>
      </div>

      <Card>
        <div className="adm-toolbar">
          <div style={{ flex: 1, minWidth: 220 }}>
            <Input
              dir="ltr"
              style={{ textAlign: 'left', fontFamily: 'monospace' }}
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              placeholder="فیلتر اقدام؛ مثلاً admin. یا payment"
              aria-label="فیلتر اقدام رویداد"
            />
          </div>
        </div>

        {loading ? (
          <PageLoading />
        ) : items.length === 0 ? (
          <EmptyState icon="📜" title="رویدادی ثبت نشده است" description="به‌محض فعالیت کاربران، گزارش‌ها اینجا نمایش داده می‌شوند." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>زمان</th>
                    <th>اقدام</th>
                    <th>کنشگر</th>
                    <th>موضوع</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{faDateTime(a.createdAt)}</td>
                      <td style={{ fontWeight: 600 }}>
                        {AUDIT_ACTION_FA[a.action ?? ''] ?? a.action}
                        {a.action && !AUDIT_ACTION_FA[a.action] && (
                          <code dir="ltr" style={{ display: 'block', fontSize: 11, color: 'var(--text-2)' }}>{a.action}</code>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {a.actorRole && <Badge tone={a.actorRole === 'USER' ? 'muted' : 'brand'}>{ROLE_FA[a.actorRole] ?? a.actorRole}</Badge>}
                          <span dir="ltr" style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.actorId ? a.actorId.slice(0, 10) : 'سیستم'}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {a.subjectType ? `${a.subjectType} ${a.subjectId ? `· ${a.subjectId.slice(0, 10)}` : ''}` : '—'}
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
    </>
  );
}
