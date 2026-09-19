import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Eye, RefreshCw, Sparkles } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
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
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { get, post, ApiError } from '../../lib/api';
import { faDateTime, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { errorMessage, ErrorCard, PlanLimitBanner } from '../publishing/parts';
import { faMonthLabel } from '../analytics/analyticsParts';

/**
 * AI — job submission + polling + usage (contract §AI).
 * Shapes verified against app/src/modules/ai/ai.routes.ts + ai.service.ts:
 *  - POST /ai/jobs {purpose, prompt, system?, provider?, model?, botId?} → 202
 *    { jobId, status, queued }.
 *  - GET /ai/jobs/:id → { id, purpose, provider, model, status, output, error,
 *    errorClass, creditsUsed, createdAt, completedAt }.
 *  - Status enum is QUEUED | PROCESSING | COMPLETED | FAILED (the lib/format
 *    aiJobStatusLabels map says DONE — the real backend value is COMPLETED).
 *  - GET /ai/usage → { used, quota, month: 'YYYY-MM' }.
 */

type AiPurpose = 'COPY' | 'RESPOND' | 'SUMMARY' | 'CUSTOM';
type AiProviderName = 'OPENAI' | 'GEMINI' | 'DEEPSEEK' | 'CLAUDE' | 'OPENROUTER' | 'MISTRAL' | 'CUSTOM';
type AiStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface AiJobRecord {
  id: number | string;
  purpose?: AiPurpose | string;
  provider?: AiProviderName | string | null;
  model?: string | null;
  status?: AiStatus | string;
  output?: string | null;
  error?: string | null;
  errorClass?: string | null;
  creditsUsed?: number | null;
  createdAt?: string;
  completedAt?: string | null;
}

interface AiUsageResponse {
  used?: number;
  quota?: number;
  month?: string;
}

const PURPOSE_LABELS: Record<string, string> = {
  COPY: 'تولید محتوا',
  RESPOND: 'پاسخ‌گویی',
  SUMMARY: 'خلاصه‌سازی',
  CUSTOM: 'سفارشی',
};

const PROVIDER_LABELS: Record<string, string> = {
  OPENAI: 'OpenAI',
  GEMINI: 'Gemini',
  DEEPSEEK: 'DeepSeek',
  CLAUDE: 'Claude',
  OPENROUTER: 'OpenRouter',
  MISTRAL: 'Mistral',
  CUSTOM: 'سرویس سفارشی',
};

/** Real backend status values (lib/format's map uses DONE which never occurs). */
const STATUS_LABELS: Record<string, string> = {
  QUEUED: 'در صف',
  PROCESSING: 'در حال پردازش',
  COMPLETED: 'تکمیل شد',
  FAILED: 'ناموفق',
};

const STATUS_TONES: Record<string, 'info' | 'success' | 'danger' | 'neutral'> = {
  QUEUED: 'info',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
};

function statusBadge(status: string | null | undefined) {
  const key = status ?? '';
  return (
    <Badge tone={STATUS_TONES[key] ?? 'neutral'}>{STATUS_LABELS[key] ?? (key || '—')}</Badge>
  );
}

function CopyButton({ text, label = 'کپی' }: { text: string; label?: string }) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          pushToast('error', 'کپی در کلیپ‌بورد ممکن نشد؛ متن را دستی انتخاب کنید.');
        }
      }}
    >
      {copied ? <Check aria-hidden="true" className="size-4 text-green-700" /> : <Copy aria-hidden="true" className="size-4" />}
      {copied ? 'کپی شد' : label}
    </Button>
  );
}

export default function AiPage() {
  usePageTitle('هوش مصنوعی');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  /* ------------------------------- create form ------------------------------ */
  const [purpose, setPurpose] = useState<AiPurpose>('COPY');
  const [prompt, setPrompt] = useState('');
  const [system, setSystem] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [planLimit, setPlanLimit] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [viewJob, setViewJob] = useState<AiJobRecord | null>(null);

  const invalidateJobs = () => {
    void queryClient.invalidateQueries({ queryKey: ['ai', 'jobs'] });
    void queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      post<{ jobId?: number; status?: string; queued?: boolean }>('/ai/jobs', {
        purpose,
        prompt: prompt.trim(),
        ...(system.trim() ? { system: system.trim() } : {}),
        ...(provider ? { provider } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      }),
    onSuccess: (data) => {
      pushToast('success', 'درخواست شما در صف پردازش قرار گرفت.');
      setPrompt('');
      setSystem('');
      setModel('');
      if (typeof data?.jobId === 'number') setActiveJobId(data.jobId);
      invalidateJobs();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.code === 'PLAN_LIMIT') {
        setPlanLimit(e.message);
        pushToast('error', e.message);
        return;
      }
      pushToast('error', errorMessage(e));
    },
  });

  function submitJob() {
    setFieldError(null);
    const len = prompt.trim().length;
    if (len < 1) {
      setFieldError('متن درخواست را وارد کنید.');
      return;
    }
    if (len > 8000) {
      setFieldError('متن درخواست حداکثر ۸۰۰۰ کاراکتر است.');
      return;
    }
    if (system.trim().length > 2000) {
      setFieldError('دستور سیستمی حداکثر ۲۰۰۰ کاراکتر است.');
      return;
    }
    createMutation.mutate();
  }

  /* ------------------------------ poll active job --------------------------- */
  const activeJob = useQuery({
    queryKey: ['ai', 'job', activeJobId],
    enabled: activeJobId !== null,
    queryFn: () => get<AiJobRecord>(`/ai/jobs/${activeJobId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'COMPLETED' || status === 'FAILED' ? false : 3000;
    },
  });

  /* ---------------------------------- usage --------------------------------- */
  const usage = useQuery({
    queryKey: ['ai', 'usage'],
    queryFn: () => get<AiUsageResponse>('/ai/usage'),
  });

  const used = usage.data?.used ?? 0;
  const quota = usage.data?.quota ?? 0;
  const usagePct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;

  /* --------------------------------- jobs list ------------------------------ */
  const list = usePaged<AiJobRecord>({
    queryKey: ['ai', 'jobs'],
    buildPath: (page, limit) => `/ai/jobs?page=${page}&limit=${limit}`,
  });

  return (
    <>
      <PageHeader
        title="هوش مصنوعی"
        description="تولید محتوا، خلاصه‌سازی و پاسخ‌گویی با اعتبار پلن شما"
      />

      <div className="space-y-6">
        {planLimit && <PlanLimitBanner message={planLimit} />}

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Create job form */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles aria-hidden="true" className="size-4 text-primary-700" />
                درخواست جدید
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="هدف"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as AiPurpose)}
                  required
                >
                  <option value="COPY">تولید محتوا</option>
                  <option value="RESPOND">پاسخ‌گویی</option>
                  <option value="SUMMARY">خلاصه‌سازی</option>
                  <option value="CUSTOM">سفارشی</option>
                </Select>
                <Select
                  label="سرویس هوش مصنوعی"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  hint="اختیاری؛ پیش‌فرض پُست‌یار"
                >
                  <option value="">پیش‌فرض پُست‌یار</option>
                  <option value="OPENAI">OpenAI</option>
                  <option value="GEMINI">Gemini</option>
                  <option value="DEEPSEEK">DeepSeek</option>
                  <option value="CLAUDE">Claude</option>
                  <option value="OPENROUTER">OpenRouter</option>
                  <option value="MISTRAL">Mistral</option>
                  <option value="CUSTOM">سرویس سفارشی</option>
                </Select>
              </div>
              <Textarea
                label="متن درخواست"
                required
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="مثلاً: یک پست تبلیغاتی کوتاه دربارهٔ تخفیف پایان فصل بنویس."
                hint={`${toFa(prompt.length)} از ۸۰۰۰ کاراکتر`}
                error={fieldError ?? undefined}
              />
              <Textarea
                label="دستور سیستمی"
                rows={2}
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                placeholder="مثلاً: لحن دوستانه و رسمی داشته باشد."
                hint="اختیاری؛ حداکثر ۲۰۰۰ کاراکتر"
              />
              <Input
                label="مدل"
                dir="ltr"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="مثلاً gpt-4o-mini"
                hint="اختیاری؛ نام دقیق مدل سرویس‌دهنده"
              />
              <div className="flex items-center gap-2 pt-1">
                <Button loading={createMutation.isPending} onClick={submitJob}>
                  ارسال درخواست
                </Button>
                <span className="text-xs text-neutral-500">پاسخ معمولاً چند ثانیه تا چند دقیقه بعد آماده می‌شود.</span>
              </div>
            </CardBody>
          </Card>

          {/* Usage card */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>مصرف اعتبار</CardTitle>
            </CardHeader>
            <CardBody>
              {usage.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ) : usage.error ? (
                <ErrorCard message={errorMessage(usage.error)} onRetry={() => void usage.refetch()} />
              ) : (
                <div>
                  <p className="text-2xl font-bold text-neutral-900">
                    {toFa(used)}
                    <span className="ms-1 text-sm font-normal text-neutral-500">
                      از {toFa(quota)} اعتبار
                    </span>
                  </p>
                  <div
                    role="progressbar"
                    aria-valuenow={usagePct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="مصرف اعتبار هوش مصنوعی"
                    className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-neutral-100"
                  >
                    <div
                      className={
                        'h-full rounded-full transition-colors ' +
                        (usagePct >= 90 ? 'bg-red-500' : usagePct >= 70 ? 'bg-amber-500' : 'bg-primary-600')
                      }
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    {toFa(usagePct)}٪ مصرف‌شده · دورهٔ {usage.data?.month ? faMonthLabel(usage.data.month) : '—'}
                  </p>
                  {quota > 0 && used >= quota && (
                    <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      سهمیه این ماه به پایان رسیده است.{' '}
                      <Link to="/app/subscription" className="font-medium underline">
                        ارتقای پلن
                      </Link>
                    </p>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Active job poll result */}
        {activeJobId !== null && (
          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>نتیجهٔ درخواست جاری (شناسه {toFa(activeJobId)})</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setActiveJobId(null)}>
                بستن
              </Button>
            </CardHeader>
            <CardBody>
              {activeJob.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : activeJob.error ? (
                <ErrorCard message={errorMessage(activeJob.error)} onRetry={() => void activeJob.refetch()} />
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    {statusBadge(activeJob.data?.status)}
                    <span>هدف: {PURPOSE_LABELS[String(activeJob.data?.purpose ?? '')] ?? String(activeJob.data?.purpose ?? '—')}</span>
                    <span>اعتبار مصرفی: {toFa(activeJob.data?.creditsUsed ?? 0)}</span>
                    {activeJob.data?.status === 'QUEUED' || activeJob.data?.status === 'PROCESSING' ? (
                      <span className="inline-flex items-center gap-1">
                        <RefreshCw aria-hidden="true" className="size-3.5 animate-spin" />
                        هر ۳ ثانیه بررسی می‌شود…
                      </span>
                    ) : null}
                  </div>
                  {activeJob.data?.error ? (
                    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                      {activeJob.data.error}
                    </p>
                  ) : null}
                  {activeJob.data?.output ? (
                    <div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-7 text-neutral-800">
                        {activeJob.data.output}
                      </pre>
                      <div className="mt-3">
                        <CopyButton text={activeJob.data.output} label="کپی خروجی" />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* Jobs list */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-neutral-900">تاریخچه درخواست‌ها</h2>
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
              icon={Sparkles}
              title="هنوز درخواستی ثبت نکرده‌اید"
              description="اولین درخواست هوش مصنوعی خود را از فرم بالا ارسال کنید."
            />
          ) : (
            <>
              <Table caption="تاریخچه درخواست‌های هوش مصنوعی">
                <THead>
                  <TR>
                    <TH>هدف</TH>
                    <TH>وضعیت</TH>
                    <TH>اعتبار</TH>
                    <TH>زمان</TH>
                    <TH>عملیات</TH>
                  </TR>
                </THead>
                <TBody>
                  {list.items.map((job) => (
                    <TR key={String(job.id)}>
                      <TD className="font-medium text-neutral-900">
                        {PURPOSE_LABELS[String(job.purpose ?? '')] ?? String(job.purpose ?? '—')}
                      </TD>
                      <TD>{statusBadge(job.status)}</TD>
                      <TD>{toFa(job.creditsUsed ?? 0)}</TD>
                      <TD className="text-xs text-neutral-500">{faDateTime(job.createdAt)}</TD>
                      <TD>
                        <Button size="sm" variant="secondary" onClick={() => setViewJob(job)}>
                          <Eye aria-hidden="true" className="size-4" />
                          مشاهده
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                className="mt-4"
                page={list.page}
                totalPages={list.totalPages}
                onChange={list.setPage}
              />
            </>
          )}
        </div>
      </div>

      {/* Output dialog */}
      <Dialog
        open={viewJob !== null}
        onClose={() => setViewJob(null)}
        title={`جزئیات درخواست #${toFa(String(viewJob?.id ?? ''))}`}
        description={
          viewJob
            ? `${PURPOSE_LABELS[String(viewJob.purpose ?? '')] ?? viewJob.purpose} · ${faDateTime(viewJob.createdAt)}`
            : undefined
        }
        size="lg"
        footer={viewJob?.output ? <CopyButton text={viewJob.output} label="کپی خروجی" /> : undefined}
      >
        {viewJob && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              {statusBadge(viewJob.status)}
              {viewJob.provider ? <span>سرویس: {PROVIDER_LABELS[viewJob.provider] ?? viewJob.provider}</span> : null}
              {viewJob.model ? (
                <span dir="ltr">
                  مدل: {viewJob.model}
                </span>
              ) : null}
              <span>اعتبار مصرفی: {toFa(viewJob.creditsUsed ?? 0)}</span>
            </div>
            {viewJob.error ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                {viewJob.error}
              </p>
            ) : null}
            {viewJob.output ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-7 text-neutral-800">
                {viewJob.output}
              </pre>
            ) : viewJob.status === 'QUEUED' || viewJob.status === 'PROCESSING' ? (
              <p className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm text-blue-800">
                این درخواست در صف پردازش است؛ پس از تکمیل، خروجی از فهرست قابل مشاهده خواهد بود.
              </p>
            ) : (
              <p className="text-sm text-neutral-500">خروجی ثبت‌شده‌ای برای این درخواست وجود ندارد.</p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
