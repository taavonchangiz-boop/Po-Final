import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, KeyRound, RefreshCw, ShoppingBag, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { Dialog } from '../../components/ui/Dialog';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { get, post, del, ApiError } from '../../lib/api';
import { faMoney, faDateTime, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { errorMessage, ErrorCard } from '../publishing/parts';
import { siteStatusLabels, siteStatusTones, buildProductBody, type WpProductRecord } from './wooParts';

/**
 * WooCommerce — site pairing + products (contract §WordPress).
 * Shapes verified against app/src/modules/wordpress/wordpress.routes.ts +
 * wordpress.service.ts:
 *  - POST /wordpress/sites {siteUrl (url), siteName?} → 201 { site, secret,
 *    instructions } — secret is shown ONCE.
 *  - Sites rows: { id, siteUrl, siteName, publicId, status: PENDING|CONNECTED|
 *    ERROR|REVOKED, lastSeenAt, lastError, createdAt, updatedAt }.
 *  - POST /sites/:id/rotate-secret → { secret, instructions } (shown once).
 *  - DELETE /sites/:id → { ok: true }.
 *  - GET /sites/:id/products?page&limit → { items: WpProductRow[], total, page, limit }.
 *  - POST /sites/:id/sync → 202 { queued, siteId }.
 *  - Product → DRAFT post via POST /posts { title, body, channelIds: [] }.
 */

interface WpSiteRecord {
  id: number | string;
  siteUrl?: string;
  siteName?: string | null;
  publicId?: string;
  status?: string;
  lastSeenAt?: string | null;
  lastError?: string | null;
  createdAt?: string;
}

interface CreateSiteResponse {
  site?: WpSiteRecord;
  secret?: string;
  instructions?: string;
}

function SecretBox({ value }: { value: string }) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code dir="ltr" className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800">
        {value}
      </code>
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            pushToast('error', 'کپی در کلیپ‌بورد ممکن نشد.');
          }
        }}
      >
        {copied ? <Check aria-hidden="true" className="size-4 text-green-700" /> : <Copy aria-hidden="true" className="size-4" />}
        {copied ? 'کپی شد' : 'کپی'}
      </Button>
    </div>
  );
}

/** Pairing success dialog — create or rotate; secret shown once with the guide. */
function PairingDialog({
  open,
  onClose,
  site,
  secret,
  isRotate,
}: {
  open: boolean;
  onClose: () => void;
  site: WpSiteRecord | null;
  secret: string;
  isRotate: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isRotate ? 'کلید جدید سایت' : 'سایت وردپرسی متصل شد'}
      description={site?.siteName ?? undefined}
      size="lg"
      footer={<Button onClick={onClose}>متوجه شدم</Button>}
    >
      <div className="space-y-4">
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm font-medium text-amber-800">
          این کلید فقط یک‌بار نمایش داده می‌شود. آن را همین حالا کپی و در افزونه ذخیره کنید.
        </p>
        <div>
          <p className="mb-1.5 text-sm font-medium text-neutral-700">شناسه عمومی سایت (Public ID)</p>
          <SecretBox value={site?.publicId ?? '—'} />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-neutral-700">کلید امضا (Secret)</p>
          <SecretBox value={secret} />
        </div>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-semibold text-neutral-900">راهنمای اتصال افزونه</p>
          <ol className="mt-2 list-decimal space-y-1.5 pe-4 text-sm leading-6 text-neutral-600">
            <li>افزونهٔ «پُستیار کانکتور» (Postyar Connector) را در وردپرس نصب و فعال کنید.</li>
            <li>در تنظیمات افزونه، نشانی پنل پُستیار، شناسهٔ عمومی و کلید امضای بالا را وارد کنید.</li>
            <li>تنظیمات را ذخیره کنید تا آزمون اتصال انجام شود؛ وضعیت سایت به «متصل» تغییر می‌کند.</li>
          </ol>
        </div>
      </div>
    </Dialog>
  );
}

export default function WooPage() {
  usePageTitle('ووکامرس');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [addOpen, setAddOpen] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  const [siteName, setSiteName] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  const [pairing, setPairing] = useState<{ site: WpSiteRecord; secret: string; isRotate: boolean } | null>(null);
  const [rotateId, setRotateId] = useState<number | string | null>(null);
  const [deleteId, setDeleteId] = useState<number | string | null>(null);
  const [productsSite, setProductsSite] = useState<WpSiteRecord | null>(null);
  const [productsPage, setProductsPage] = useState(1);

  const invalidateSites = () => {
    void queryClient.invalidateQueries({ queryKey: ['wordpress', 'sites'] });
  };

  /* --------------------------------- sites list ------------------------------ */
  const list = usePaged<WpSiteRecord>({
    queryKey: ['wordpress', 'sites'],
    buildPath: (page, limit) => `/wordpress/sites?page=${page}&limit=${limit}`,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      post<CreateSiteResponse>('/wordpress/sites', {
        siteUrl: siteUrl.trim(),
        ...(siteName.trim() ? { siteName: siteName.trim() } : {}),
      }),
    onSuccess: (data) => {
      pushToast('success', 'سایت وردپرسی ثبت شد؛ کلید اتصال را ذخیره کنید.');
      setAddOpen(false);
      setSiteUrl('');
      setSiteName('');
      if (data?.site && data.secret) {
        setPairing({ site: data.site, secret: data.secret, isRotate: false });
      }
      invalidateSites();
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  function submitSite() {
    setUrlError(null);
    const raw = siteUrl.trim();
    try {
      const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      if (!/^https?:$/.test(parsed.protocol) || parsed.hostname.length < 4) throw new Error('bad');
      setSiteUrl(`${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`);
    } catch {
      setUrlError('نشانی سایت معتبر نیست؛ مثال: https://example.com');
      return;
    }
    createMutation.mutate();
  }

  const rotateMutation = useMutation({
    mutationFn: (id: number | string) =>
      post<{ secret?: string }>(`/wordpress/sites/${id}/rotate-secret`),
    onSuccess: (data) => {
      const site = list.items.find((s) => String(s.id) === String(rotateId)) ?? null;
      if (data?.secret && site) {
        setPairing({ site, secret: data.secret, isRotate: true });
      }
      pushToast('success', 'کلید جدید ساخته شد؛ آن را در افزونه به‌روزرسانی کنید.');
      setRotateId(null);
      invalidateSites();
    },
    onError: (e: unknown) => {
      pushToast('error', errorMessage(e));
      setRotateId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number | string) => del<{ ok?: boolean }>(`/wordpress/sites/${id}`),
    onSuccess: () => {
      pushToast('success', 'سایت وردپرسی باطل شد و دیگر پیامکی دریافت نمی‌کند.');
      setDeleteId(null);
      invalidateSites();
    },
    onError: (e: unknown) => {
      pushToast('error', errorMessage(e));
      setDeleteId(null);
    },
  });

  /* ------------------------------- products dialog --------------------------- */
  const productsQuery = useQuery({
    queryKey: ['wordpress', 'products', productsSite?.id, productsPage],
    enabled: productsSite !== null,
    queryFn: () =>
      get<{ items?: WpProductRecord[]; total?: number; page?: number; limit?: number }>(
        `/wordpress/sites/${String(productsSite?.id)}/products?page=${productsPage}&limit=10`,
      ),
  });

  const products = productsQuery.data?.items ?? [];
  const productsTotal = productsQuery.data?.total ?? 0;
  const productsTotalPages = Math.max(1, Math.ceil(productsTotal / 10));

  const makePostMutation = useMutation({
    mutationFn: (product: WpProductRecord) =>
      post<{ postId?: number; status?: string }>('/posts', {
        title: (product.title ?? '').slice(0, 190),
        body: buildProductBody(product),
        channelIds: [],
      }),
    onSuccess: (data) => {
      pushToast(
        'success',
        data?.status === 'DRAFT'
          ? 'پیش‌نویس پست از محصول ساخته شد؛ از بخش انتشار آن را ارسال کنید.'
          : 'پست از محصول ساخته شد.',
      );
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: number | string) => post<{ queued?: boolean }>(`/wordpress/sites/${id}/sync`),
    onSuccess: (data) => {
      if (data?.queued) {
        pushToast('success', 'همگام‌سازی در صف قرار گرفت.');
      } else {
        pushToast('info', 'صف پردازش در دسترس نیست؛ چند لحظه بعد تلاش کنید.');
      }
      invalidateSites();
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const deleteTarget = list.items.find((s) => String(s.id) === String(deleteId)) ?? null;

  return (
    <>
      <PageHeader
        title="ووکامرس"
        description="اتصال فروشگاه وردپرسی و ساخت پست از محصولات"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <ShoppingBag aria-hidden="true" className="size-4" />
            افزودن سایت
          </Button>
        }
      />

      <div className="space-y-4">
        {list.isLoading ? (
          <Card>
            <CardBody className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardBody>
          </Card>
        ) : list.error ? (
          <ErrorCard message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : list.items.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="هنوز سایتی متصل نکرده‌اید"
            description="با افزودن سایت و نصب افزونهٔ پُستیار کانکتور، محصولات ووکامرس به‌صورت خودکار دریافت می‌شوند."
            action={
              <Button onClick={() => setAddOpen(true)}>
                <ShoppingBag aria-hidden="true" className="size-4" />
                افزودن سایت
              </Button>
            }
          />
        ) : (
          <>
            <Table caption="فهرست سایت‌های وردپرسی متصل">
              <THead>
                <TR>
                  <TH>نشانی</TH>
                  <TH>نام</TH>
                  <TH>وضعیت</TH>
                  <TH>آخرین اتصال</TH>
                  <TH>عملیات</TH>
                </TR>
              </THead>
              <TBody>
                {list.items.map((site) => {
                  const statusKey = site.status ?? '';
                  return (
                    <TR key={String(site.id)}>
                      <TD dir="ltr" className="max-w-56 truncate font-medium text-neutral-900">
                        {site.siteUrl || '—'}
                      </TD>
                      <TD>{site.siteName || '—'}</TD>
                      <TD>
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={siteStatusTones[statusKey] ?? 'neutral'}>
                            {siteStatusLabels[statusKey] ?? (statusKey || '—')}
                          </Badge>
                          {site.lastError ? (
                            <span className="max-w-56 truncate text-xs text-red-600" title={site.lastError}>
                              {site.lastError}
                            </span>
                          ) : null}
                        </div>
                      </TD>
                      <TD className="text-xs text-neutral-500">
                        {site.lastSeenAt ? faDateTime(site.lastSeenAt) : 'هنوز متصل نشده'}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" variant="secondary" onClick={() => { setProductsSite(site); setProductsPage(1); }}>
                            محصولات
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={syncMutation.isPending && syncMutation.variables === site.id}
                            disabled={syncMutation.isPending}
                            onClick={() => syncMutation.mutate(site.id)}
                          >
                            <RefreshCw aria-hidden="true" className="size-4" />
                            همگام‌سازی
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRotateId(site.id)}>
                            <KeyRound aria-hidden="true" className="size-4" />
                            چرخش کلید
                          </Button>
                          <Button size="sm" variant="ghost" disabled={deleteMutation.isPending} onClick={() => setDeleteId(site.id)}>
                            <Trash2 aria-hidden="true" className="size-4 text-red-600" />
                            حذف
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination className="mt-4" page={list.page} totalPages={list.totalPages} onChange={list.setPage} />
          </>
        )}
      </div>

      {/* ------------------------------ add site dialog ----------------------------- */}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="افزودن سایت وردپرسی"
        description="نشانی فروشگاه ووکامرس خود را وارد کنید تا شناسه و کلید اتصال ساخته شود."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitSite();
          }}
        >
          <Input
            label="نشانی سایت"
            dir="ltr"
            required
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://example.com"
            error={urlError ?? undefined}
            hint="نشانی اصلی فروشگاه ووکامرس شما."
          />
          <Input
            label="نام سایت"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="مثلاً فروشگاه اصلی"
            hint="اختیاری؛ برای نمایش در فهرست."
          />
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" loading={createMutation.isPending}>
              ثبت سایت
            </Button>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>
              انصراف
            </Button>
          </div>
        </form>
      </Dialog>

      {/* --------------------------- pairing / rotate secret ------------------------ */}
      <PairingDialog
        open={pairing !== null}
        onClose={() => setPairing(null)}
        site={pairing?.site ?? null}
        secret={pairing?.secret ?? ''}
        isRotate={pairing?.isRotate === true}
      />

      {/* ----------------------------- rotate confirm ------------------------------ */}
      <ConfirmDialog
        open={rotateId !== null}
        onClose={() => setRotateId(null)}
        onConfirm={() => {
          if (rotateId !== null) rotateMutation.mutate(rotateId);
        }}
        loading={rotateMutation.isPending}
        title="چرخش کلید اتصال"
        description="کلید فعلی باطل و کلید جدیدی ساخته می‌شود. باید کلید جدید را در تنظیمات افزونه وارد کنید وگرنه همگام‌سازی متوقف می‌ماند."
        confirmLabel="ساخت کلید جدید"
      />

      {/* ----------------------------- delete confirm ------------------------------ */}
      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId !== null) deleteMutation.mutate(deleteId);
        }}
        loading={deleteMutation.isPending}
        title="حذف سایت وردپرسی"
        description={`آیا از حذف «${deleteTarget?.siteName || deleteTarget?.siteUrl || 'این سایت'}» مطمئن هستید؟ افزونهٔ سایت دیگر قادر به ارسال محصولات نخواهد بود؛ محصولات همگام‌شده در گزارش‌ها باقی می‌مانند.`}
        confirmLabel="بله، حذف کن"
      />

      {/* ------------------------------ products dialog ----------------------------- */}
      <Dialog
        open={productsSite !== null}
        onClose={() => setProductsSite(null)}
        title={`محصولات ${productsSite?.siteName || ''}`}
        description={productsSite?.siteUrl}
        size="lg"
      >
        {productsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : productsQuery.error ? (
          <ErrorCard message={errorMessage(productsQuery.error)} onRetry={() => void productsQuery.refetch()} />
        ) : products.length === 0 ? (
          <EmptyState
            title="هنوز محصولی همگام نشده است"
            description="پس از اتصال افزونه و اجرای «همگام‌سازی»، محصولات اینجا نمایش داده می‌شوند."
          />
        ) : (
          <div className="space-y-4">
            <Table caption="محصولات همگام‌شدهٔ سایت">
              <THead>
                <TR>
                  <TH>عنوان</TH>
                  <TH>قیمت</TH>
                  <TH>موجودی</TH>
                  <TH>آخرین همگام‌سازی</TH>
                  <TH>عملیات</TH>
                </TR>
              </THead>
              <TBody>
                {products.map((p) => (
                  <TR key={String(p.id)}>
                    <TD className="max-w-56 font-medium text-neutral-900">
                      {p.title || '—'}
                      {p.permalink ? (
                        <a
                          href={p.permalink}
                          target="_blank"
                          rel="noreferrer"
                          dir="ltr"
                          className="focus-ring mt-0.5 flex items-center gap-1 truncate text-xs text-primary-700 hover:underline"
                        >
                          <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
                          <span className="truncate">{p.permalink}</span>
                        </a>
                      ) : null}
                    </TD>
                    <TD>{typeof p.price === 'number' ? faMoney(p.price) : '—'}</TD>
                    <TD>{typeof p.stock === 'number' ? toFa(p.stock) : 'نامشخص'}</TD>
                    <TD className="text-xs text-neutral-500">{p.lastSyncedAt ? faDateTime(p.lastSyncedAt) : '—'}</TD>
                    <TD>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={makePostMutation.isPending && makePostMutation.variables === p}
                        disabled={makePostMutation.isPending}
                        onClick={() => makePostMutation.mutate(p)}
                      >
                        ساخت پست
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={productsPage}
              totalPages={productsTotalPages}
              onChange={(p) => setProductsPage(p)}
            />
          </div>
        )}
      </Dialog>
    </>
  );
}
