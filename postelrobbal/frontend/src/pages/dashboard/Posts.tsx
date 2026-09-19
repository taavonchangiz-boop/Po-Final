import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiRequestError, type Page, type PostDto } from '../../lib/api';
import { Badge, Button, EmptyState, Input, PageLoading, Pagination, Select, StatusBadge } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { faDate, faDateTime, POST_STATE_FA } from '../../lib/format';

const SOURCE_FA: Record<string, string> = {
  MANUAL: 'دستی',
  GOLD: 'طلا',
  WORDPRESS: 'ووکامرس',
  WORKFLOW: 'گردش‌کار',
};

const SOURCE_TONE: Record<string, 'brand' | 'warning' | 'info' | 'muted'> = {
  MANUAL: 'brand',
  GOLD: 'warning',
  WORDPRESS: 'info',
  WORKFLOW: 'muted',
};

const STATE_KEYS = Object.keys(POST_STATE_FA);

function snippet(text: string, max = 70): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

export default function Posts() {
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<PostDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const pageSize = 10;

  // Debounced search (§ input latency): typing updates the query 350ms after the last keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (stateFilter) params.set('state', stateFilter);
      if (search) params.set('search', search);
      const data = await api.get<Page<PostDto>>(`/api/v1/posts?${params.toString()}`);
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setLoading(false);
    }
  }, [page, stateFilter, search, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>پست‌ها</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>مدیریت و پیگیری پست‌های ساخته‌شده</p>
        </div>
        <Link to="/dashboard/posts/new" className="btn btn-primary">+ پست جدید</Link>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="جست‌وجو در عنوان یا متن پست…"
          aria-label="جست‌وجوی پست"
          style={{ flex: 1, minWidth: 220 }}
        />
        <Select
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value);
            setPage(1);
          }}
          aria-label="فیلتر وضعیت"
          style={{ minWidth: 180 }}
        >
          <option value="">همهٔ وضعیت‌ها</option>
          {STATE_KEYS.map((k) => (
            <option key={k} value={k}>{POST_STATE_FA[k]}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <PageLoading />
      ) : items.length === 0 ? (
        <EmptyState
          icon="✉️"
          title={search || stateFilter ? 'پستی یافت نشد' : 'هنوز پستی نساخته‌اید'}
          description={
            search || stateFilter
              ? 'با این شرایط جست‌وجو، پستی پیدا نشد. عبارت یا فیلتر دیگری را امتحان کنید.'
              : 'اولین پست خود را بسازید و در کانال‌هایتان منتشر کنید.'
          }
          action={
            search || stateFilter ? (
              <Button variant="ghost" onClick={() => { setSearchInput(''); setStateFilter(''); setPage(1); }}>
                پاک کردن فیلترها
              </Button>
            ) : (
              <Link to="/dashboard/posts/new" className="btn btn-primary">ساخت پست جدید</Link>
            )
          }
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>پست</th>
                  <th>وضعیت</th>
                  <th>منبع</th>
                  <th>زمان انتشار</th>
                  <th>تاریخ ایجاد</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/dashboard/posts/${p.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') navigate(`/dashboard/posts/${p.id}`);
                    }}
                    style={{ cursor: 'pointer' }}
                    tabIndex={0}
                    aria-label={`مشاهده جزئیات پست ${p.title ?? 'بدون عنوان'}`}
                  >
                    <td style={{ maxWidth: 340 }}>
                      <Link
                        to={`/dashboard/posts/${p.id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontWeight: 700, color: 'var(--text)' }}
                      >
                        {p.title?.trim() || 'بدون عنوان'}
                      </Link>
                      <div style={{ color: 'var(--text-2)', fontSize: 12, marginTop: 2 }}>{snippet(p.body)}</div>
                    </td>
                    <td><StatusBadge state={p.state} labels={POST_STATE_FA} /></td>
                    <td><Badge tone={SOURCE_TONE[p.source] ?? 'muted'}>{SOURCE_FA[p.source] ?? p.source}</Badge></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.scheduledAt ? faDateTime(p.scheduledAt) : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{faDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
