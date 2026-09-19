import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageLoading, Pagination, StatusBadge } from '../../components/ui';
import { faMoney, faRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';

const WP_STATUS_FA: Record<string, string> = {
  ACTIVE: 'فعال',
  PENDING: 'در انتظار اتصال',
  DISABLED: 'غیرفعال',
  ERROR: 'خطا',
};

interface SiteRow {
  id: string;
  siteUrl: string;
  siteKey: string;
  status: string;
  lastSyncAt?: string | null;
  autoPublish?: number | boolean | null;
}

interface ProductRow {
  id: string;
  title: string;
  priceRial?: number | null;
  lastSyncedAt?: string | null;
  lastPublishedAt?: string | null;
}

interface NewCredentials {
  siteKey: string;
  secret: string;
  siteUrl: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export default function WooCommerce() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<SiteRow[]>([]);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [productsPage, setProductsPage] = useState(1);
  const [productsLoading, setProductsLoading] = useState(true);

  const [connectOpen, setConnectOpen] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [credentials, setCredentials] = useState<NewCredentials | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadSites = useCallback(async () => {
    const d = await api.get<{ sites?: SiteRow[] }>('/api/v1/wordpress/sites');
    setSites(d.sites ?? []);
  }, []);

  const loadProducts = useCallback(async (page: number) => {
    setProductsLoading(true);
    try {
      const d = await api.get<{ items?: ProductRow[]; total?: number; page?: number }>(`/api/v1/wordpress/products?page=${page}`);
      setProducts(d.items ?? []);
      setProductsTotal(Number(d.total ?? 0));
      setProductsPage(Number(d.page ?? page));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت محصولات ناموفق بود.');
    } finally {
      setProductsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      try {
        await loadSites();
      } catch (err) {
        toast.error(err instanceof ApiRequestError ? err.message : 'دریافت سایت‌ها ناموفق بود.');
      } finally {
        setLoading(false);
      }
    })();
    void loadProducts(1);
  }, [loadSites, loadProducts, toast]);

  const connect = async () => {
    if (!siteUrl.trim()) {
      toast.error('نشانی سایت را وارد کنید.');
      return;
    }
    setConnecting(true);
    try {
      const d = await api.post<{ site?: { siteKey?: string; siteUrl?: string }; secret?: string }>('/api/v1/wordpress/sites', {
        siteUrl: siteUrl.trim(),
      });
      setCredentials({
        siteKey: d.site?.siteKey ?? '',
        secret: d.secret ?? '',
        siteUrl: d.site?.siteUrl ?? siteUrl.trim(),
      });
      setConnectOpen(false);
      setSiteUrl('');
      await loadSites();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'اتصال سایت ناموفق بود.');
    } finally {
      setConnecting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setBusyId(deleteId);
    try {
      await api.del(`/api/v1/wordpress/sites/${deleteId}`);
      toast.success('سایت حذف شد.');
      setDeleteId(null);
      await loadSites();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'حذف ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmRotate = async () => {
    if (!rotateId) return;
    setBusyId(rotateId);
    try {
      const d = await api.post<{ secret?: string }>(`/api/v1/wordpress/sites/${rotateId}/rotate-secret`);
      const site = sites.find((s) => s.id === rotateId);
      setCredentials({ siteKey: site?.siteKey ?? '', secret: d.secret ?? '', siteUrl: site?.siteUrl ?? '' });
      toast.success('کلید رمز جدید ساخته شد؛ آن را در افزونه به‌روزرسانی کنید.');
      setRotateId(null);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ساخت کلید جدید ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleAutoPublish = async (site: SiteRow) => {
    const current = site.autoPublish === undefined ? true : Boolean(site.autoPublish);
    setBusyId(site.id);
    try {
      await api.post(`/api/v1/wordpress/sites/${site.id}`, { autoPublish: !current });
      toast.success(!current ? 'انتشار خودکار محصولات فعال شد.' : 'انتشار خودکار محصولات خاموش شد.');
      await loadSites();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'تغییر وضعیت انتشار خودکار ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <PageLoading />;

  const deleting = sites.find((s) => s.id === deleteId);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800 }}>ووکامرس</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>اتصال فروشگاه وردپرسی و انتشار خودکار محصولات در کانال‌ها.</p>
        </div>
        <Button onClick={() => { setCredentials(null); setConnectOpen(true); }}>+ اتصال سایت جدید</Button>
      </div>

      {credentials && (
        <div className="card" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)', marginBottom: 18 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>کلید اتصال سایت {credentials.siteUrl}</h2>
          <p style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 700, marginBottom: 12 }}>
            ⚠️ این کلید فقط یک‌بار نمایش داده می‌شود؛ همین حالا آن را کپی و در افزونه ذخیره کنید.
          </p>
          {[
            { label: 'کلید سایت', value: credentials.siteKey },
            { label: 'کلید رمز', value: credentials.secret },
          ].map((row) => (
            <div key={row.label} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)', minWidth: 64 }}>{row.label}:</span>
              <code dir="ltr" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', fontSize: 12.5, wordBreak: 'break-all', flex: 1, minWidth: 200 }}>
                {row.value}
              </code>
              <Button
                size="sm"
                variant="soft"
                onClick={() => {
                  void copyText(row.value).then((ok) => {
                    if (ok) toast.success('کپی شد.');
                    else toast.error('کپی انجام نشد؛ دستی انتخاب و کپی کنید.');
                  });
                }}
              >
                کپی
              </Button>
            </div>
          ))}
          <a href="#guide" style={{ fontSize: 13 }}>راهنمای نصب افزونه ←</a>
        </div>
      )}

      {sites.length === 0 ? (
        <EmptyState
          icon="🛍️"
          title="هنوز سایتی متصل نکرده‌اید"
          description="با نصب افزونهٔ پُستیار در وردپرس، محصولات فروشگاه به‌صورت خودکار در کانال‌ها منتشر می‌شوند."
          action={<Button onClick={() => setConnectOpen(true)}>اتصال اولین سایت</Button>}
        />
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>نشانی سایت</th>
                  <th>وضعیت</th>
                  <th>آخرین همگام‌سازی</th>
                  <th>انتشار خودکار</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const auto = s.autoPublish === undefined ? true : Boolean(s.autoPublish);
                  return (
                    <tr key={s.id}>
                      <td dir="ltr" style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12.5 }}>{s.siteUrl}</td>
                      <td><StatusBadge state={s.status} labels={WP_STATUS_FA} /></td>
                      <td>{faRelative(s.lastSyncAt)}</td>
                      <td>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={auto}
                            disabled={busyId === s.id}
                            onChange={() => void toggleAutoPublish(s)}
                            style={{ width: 17, height: 17, accentColor: 'var(--brand)' }}
                          />
                          {auto ? 'فعال' : 'خاموش'}
                        </label>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Button size="sm" variant="ghost" loading={busyId === s.id} onClick={() => setRotateId(s.id)}>کلید جدید</Button>
                          <Button size="sm" variant="danger" onClick={() => setDeleteId(s.id)}>حذف</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <h2 style={{ fontSize: 17, fontWeight: 800, margin: '26px 0 12px' }}>محصولات همگام‌شده</h2>
      <Card>
        {productsLoading ? (
          <PageLoading />
        ) : products.length === 0 ? (
          <EmptyState icon="📦" title="محصولی همگام نشده است" description="پس از اتصال سایت، افزونه محصولات را به‌صورت خودکار اینجا ثبت می‌کند." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>محصول</th>
                    <th>قیمت</th>
                    <th>آخرین همگام‌سازی</th>
                    <th>آخرین انتشار</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.title}</td>
                      <td>{p.priceRial === null || p.priceRial === undefined ? '—' : faMoney(p.priceRial)}</td>
                      <td>{faRelative(p.lastSyncedAt)}</td>
                      <td>{p.lastPublishedAt ? faRelative(p.lastPublishedAt) : 'منتشر نشده'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={productsPage} pageSize={20} total={productsTotal} onPage={(p) => void loadProducts(p)} />
          </>
        )}
      </Card>

      <div className="card" id="guide" style={{ marginTop: 22, scrollMarginTop: 80 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>راهنمای اتصال وردپرس</h2>
        <ol style={{ fontSize: 13.5, lineHeight: 2.2, paddingRight: 20, color: 'var(--text-2)' }}>
          <li>افزونهٔ «Postyar Connector» را از مخزن افزونه‌های وردپرس نصب و فعال کنید.</li>
          <li>در پیشخوان وردپرس به بخش «پُستیار» بروید.</li>
          <li>نشانی این سامانه و کلید اتصال (کلید سایت و کلید رمز) را که پس از اتصال سایت دریافت کرده‌اید وارد کنید.</li>
          <li>دکمهٔ «ذخیره و آزمایش اتصال» را بزنید؛ وضعیت سایت باید «فعال» شود.</li>
          <li>از این پس محصولات جدید و تغییرات قیمت به‌صورت خودکار همگام و در کانال‌های منتخب منتشر می‌شوند.</li>
        </ol>
      </div>

      <Modal open={connectOpen} onClose={() => setConnectOpen(false)} title="اتصال سایت وردپرسی">
        <Field label="نشانی سایت" required hint="مثلاً: https://shop.example.ir">
          <Input dir="ltr" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://example.ir" />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button onClick={() => void connect()} loading={connecting}>اتصال سایت</Button>
          <Button variant="ghost" onClick={() => setConnectOpen(false)}>انصراف</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        onConfirm={() => void confirmDelete()}
        title="حذف سایت"
        message={`آیا از حذف اتصال «${deleting?.siteUrl ?? ''}» مطمئن هستید؟ افزونهٔ سایت دیگر کار نخواهد کرد.`}
        danger
        busy={busyId === deleteId}
      />

      <ConfirmDialog
        open={Boolean(rotateId)}
        onClose={() => setRotateId(null)}
        onConfirm={() => void confirmRotate()}
        title="ساخت کلید رمز جدید"
        message="کلید رمز فعلی باطل و کلید جدیدی ساخته می‌شود. باید کلید جدید را در افزونهٔ وردپرس به‌روزرسانی کنید. ادامه می‌دهید؟"
        danger
        busy={busyId === rotateId}
      />
    </div>
  );
}
