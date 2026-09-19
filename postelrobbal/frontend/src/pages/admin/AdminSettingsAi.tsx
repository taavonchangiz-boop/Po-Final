import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Button, Card, Field, Input, PageLoading } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { boolField, errText, strField } from './shared';

/* ------------------------------------------------------------------ */
/* هوش مصنوعی — provider picker + credentials (round 18-c expands the  */
/* 17-b picker page with the api_key / custom endpoint / model card).  */
/* GET /admin/settings/ai → { default_provider, hasApiKey,             */
/*   apiKeyMasked, customBaseUrl, customModel } (raw key never).       */
/* PUT accepts { default_provider?, api_key?, custom_base_url?,        */
/*   custom_model? } — api_key is write-only ('' clears → env key).    */
/* ------------------------------------------------------------------ */

type AiProvider = 'openai' | 'deepseek' | 'mistral' | 'openrouter' | 'gemini' | 'anthropic';

const PROVIDERS: Array<{ key: AiProvider; title: string; desc: string }> = [
  { key: 'openai', title: 'OpenAI', desc: 'پیشرو در مدل‌های زبانی عمومی؛ مناسب تولید محتوا و پاسخ‌گویی' },
  { key: 'deepseek', title: 'DeepSeek', desc: 'کیفیت بالا با هزینهٔ تمام‌شدهٔ پایین‌تر' },
  { key: 'mistral', title: 'Mistral', desc: 'سریع و سبک؛ گزینهٔ اقتصادی برای کارهای روزمره' },
  { key: 'openrouter', title: 'OpenRouter', desc: 'دسترسی به ده‌ها مدل مختلف از طریق یک کلید واحد' },
  { key: 'gemini', title: 'Google Gemini', desc: 'مدل چندوجهی گوگل با پشتیبانی خوب از زبان فارسی' },
  { key: 'anthropic', title: 'Anthropic Claude', desc: 'کیفیت نوشتار بالا و پیروی دقیق از دستورها' },
];

export default function AdminSettingsAi() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [savedProvider, setSavedProvider] = useState<AiProvider>('openai');

  // credentials snapshot
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  // api_key dirty tracking: user-typed key wins; explicit clear flag sends ''
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [clearKey, setClearKey] = useState(false);

  const loadSnapshot = async (silent = false) => {
    try {
      const d = await api.get<Record<string, unknown>>('/api/v1/admin/settings/ai');
      const p = strField(d.default_provider) as AiProvider;
      const valid = PROVIDERS.some((x) => x.key === p) ? p : 'openai';
      setProvider(valid);
      setSavedProvider(valid);
      setHasApiKey(boolField(d.hasApiKey));
      setApiKeyMasked(strField(d.apiKeyMasked));
      setCustomBaseUrl(strField(d.customBaseUrl));
      setCustomModel(strField(d.customModel));
      setApiKeyInput('');
      setApiKeyDirty(false);
      setClearKey(false);
      if (!silent) return d;
    } catch (err) {
      if (!silent) toast.error(errText(err, 'دریافت تنظیمات هوش مصنوعی ناموفق بود.'));
    }
    return null;
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      await loadSnapshot();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        default_provider: provider,
        custom_base_url: customBaseUrl.trim(),
        custom_model: customModel.trim(),
      };
      if (clearKey) payload.api_key = '';
      else if (apiKeyDirty) payload.api_key = apiKeyInput;
      await api.put('/api/v1/admin/settings/ai', payload);
      toast.success(
        clearKey
          ? 'کلید ذخیره‌شده پاک شد؛ درخواست‌ها از کلید محیط سرور استفاده می‌کنند.'
          : 'تنظیمات هوش مصنوعی ذخیره شد.'
      );
      setSavedNote(true);
      await loadSnapshot(true);
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ تنظیمات هوش مصنوعی ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div className="adm-page-head">
        <h2>هوش مصنوعی</h2>
        <p>سرویس‌دهندهٔ پیش‌فرض فعلی: {PROVIDERS.find((x) => x.key === savedProvider)?.title ?? '—'}</p>
      </div>

      {savedNote && (
        <div className="adm-note adm-note--success" role="status">
          <span aria-hidden="true">✅</span>
          <span>تنظیمات هوش مصنوعی با موفقیت ذخیره شد.</span>
        </div>
      )}

      <Card>
        <div className="adm-card-head"><strong>سرویس‌دهندهٔ پیش‌فرض هوش مصنوعی</strong></div>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '0 0 12px' }}>
          این سرویس‌دهنده برای کاربرانی استفاده می‌شود که سرویس اختصاصی خودشان را تنظیم نکرده‌اند.
        </p>
        <div className="adm-picker" role="radiogroup" aria-label="انتخاب سرویس‌دهندهٔ پیش‌فرض هوش مصنوعی">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={provider === p.key}
              className={`adm-picker__tile${provider === p.key ? ' is-active' : ''}`}
              onClick={() => setProvider(p.key)}
            >
              <span className="adm-picker__title">
                {p.title}
                {provider === p.key && <Badge tone="brand">فعال</Badge>}
              </span>
              <span className="adm-picker__desc">{p.desc}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="adm-card-head">
          <strong>اعتبارنامه و مدل اختصاصی</strong>
          <span className="adm-card-head__meta">
            {hasApiKey ? `کلید ذخیره‌شده: ${apiKeyMasked}` : 'کلید محیط سرور (بدون کلید ذخیره‌شده)'}
          </span>
        </div>

        <div className="adm-form-grid">
          <Field
            label="کلید API"
            hint={
              clearKey
                ? 'در ذخیرهٔ بعدی، کلید ذخیره‌شده پاک می‌شود و سامانه به کلید محیط سرور برمی‌گردد.'
                : hasApiKey
                  ? `کلید ذخیره‌شده: ${apiKeyMasked} — برای تغییر، کلید جدید را وارد کنید؛ خالی بگذارید تا تغییر نکند.`
                  : 'کلید ذخیره نشده است؛ درخواست‌ها از کلید محیط سرور استفاده می‌کنند.'
            }
          >
            <Input
              dir="ltr"
              style={{ textAlign: 'left' }}
              type="password"
              autoComplete="new-password"
              value={apiKeyInput}
              onChange={(e) => {
                setApiKeyInput(e.target.value);
                setApiKeyDirty(true);
                setClearKey(false);
              }}
              placeholder={apiKeyMasked || 'sk-…'}
              aria-label="کلید API هوش مصنوعی"
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end', paddingBottom: 14 }}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!hasApiKey}
              onClick={() => {
                setClearKey(true);
                setApiKeyInput('');
                setApiKeyDirty(false);
              }}
            >
              پاک کردن کلید
            </Button>
          </div>
          <Field label="آدرس پایهٔ اختصاصی" hint="فقط برای سرویس‌دهنده‌های سازگار با OpenAI اعمال می‌شود.">
            <Input
              dir="ltr"
              style={{ textAlign: 'left' }}
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </Field>
          <Field label="نام مدل اختصاصی" hint="نام مدل مانند gpt-4o-mini.">
            <Input
              dir="ltr"
              style={{ textAlign: 'left' }}
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </Field>
        </div>

        {clearKey && (
          <div className="adm-note adm-note--warning" role="alert">
            <span aria-hidden="true">⚠️</span>
            <span>
              پاک‌سازی کلید در ذخیرهٔ بعدی اعمال می‌شود؛ پس از آن درخواست‌های هوش مصنوعی به کلید محیط سرور تکیه می‌کنند.{' '}
              <button type="button" className="adm-linkbtn" onClick={() => setClearKey(false)}>
                لغو پاک‌سازی
              </button>
            </span>
          </div>
        )}
      </Card>

      <Card className="adm-savebar">
        <p className="adm-savebar__hint">کلیدها به‌صورت امن ذخیره می‌شوند و هرگز دوباره نمایش داده نمی‌شوند.</p>
        <Button onClick={() => void save()} loading={saving}>ذخیرهٔ تنظیمات</Button>
      </Card>
    </>
  );
}
