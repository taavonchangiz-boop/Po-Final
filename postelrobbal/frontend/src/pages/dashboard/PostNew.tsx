import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  ApiRequestError,
  getCsrfToken,
  type ApiError,
  type ChannelDto,
} from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, PageLoading, Spinner, Textarea } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { faDigits, faNumber, PLATFORM_FA } from '../../lib/format';

type Platform = ChannelDto['platform'];

const MAX_BODY = 4000;

/**
 * Inline-button support per provider adapter (frozen capability declarations,
 * app/src/providers/*). Rubika cannot render inline buttons — the delivery
 * worker strips them, so the UI hides/disables the section accordingly.
 */
const INLINE_BUTTONS_CAP: Record<Platform, boolean> = { telegram: true, bale: true, rubika: false };

interface MediaDto {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}

/** Upload response is `{media}` — tolerant of a flat shape too. */
type MediaResponse = { media?: MediaDto; id?: string; filename?: string; mime?: string; sizeBytes?: number };

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

/** api.post cannot carry multipart FormData, so media upload uses fetch directly (same CSRF/cookie contract). */
async function uploadMedia(file: File): Promise<MediaDto | null> {
  const fd = new FormData();
  fd.append('file', file);
  const headers: Record<string, string> = { accept: 'application/json' };
  const csrf = getCsrfToken();
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch('/api/v1/media', { method: 'POST', headers, credentials: 'include', body: fd });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as { error?: ApiError } | null)?.error;
    throw new ApiRequestError(err?.code ?? 'UNKNOWN', err?.message ?? 'بارگذاری رسانه ناموفق بود.', res.status);
  }
  const data = (payload as { data: MediaResponse }).data;
  if (data.media) return data.media;
  if (data.id) return { id: data.id, filename: data.filename ?? '', mime: data.mime ?? '', sizeBytes: data.sizeBytes ?? 0 };
  return null;
}

interface ButtonRow {
  label: string;
  url: string;
}

export default function PostNew() {
  const toast = useToast();
  const navigate = useNavigate();

  const [channels, setChannels] = useState<ChannelDto[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const [media, setMedia] = useState<MediaDto | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  const [rows, setRows] = useState<ButtonRow[]>([]);
  const [rowsError, setRowsError] = useState('');

  const [scheduledAt, setScheduledAt] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ channels: ChannelDto[] }>('/api/v1/channels')
      .then((d) => {
        if (cancelled) return;
        const active = (d.channels ?? []).filter((c) => c.status === 'ACTIVE');
        setChannels(active);
      })
      .catch((e) => {
        if (!cancelled) {
          setChannels([]);
          toast.error(errText(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeChannels = channels ?? [];
  const selectedChannels = useMemo(
    () => activeChannels.filter((c) => selectedIds.includes(c.id)),
    [activeChannels, selectedIds]
  );
  const selectedPlatforms = useMemo(
    () => Array.from(new Set(selectedChannels.map((c) => c.platform))),
    [selectedChannels]
  );
  const anySelectedWithoutButtons = selectedPlatforms.some((p) => !INLINE_BUTTONS_CAP[p]);
  const buttonsDisabled = selectedPlatforms.length > 0 && selectedPlatforms.every((p) => !INLINE_BUTTONS_CAP[p]);

  const toggleChannel = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const m = await uploadMedia(file);
      if (!m) {
        toast.error('بارگذاری رسانه ناموفق بود.');
        return;
      }
      setMedia(m);
      setPreviewUrl('');
      if (m.mime.startsWith('image/')) {
        try {
          const access = await api.get<{ url: string }>(`/api/v1/media/${m.id}/token`);
          setPreviewUrl(access.url);
        } catch {
          // preview is best-effort; the media itself stays attached
        }
      }
      toast.success('رسانه پیوست شد.');
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setUploading(false);
    }
  };

  const removeMedia = () => {
    setMedia(null);
    setPreviewUrl('');
  };

  const validRows = useMemo(
    () =>
      rows
        .map((r) => ({ label: r.label.trim(), url: r.url.trim() }))
        .filter((r) => r.label !== '' && r.url !== ''),
    [rows]
  );

  const validateRows = (): boolean => {
    for (const r of rows) {
      if (r.label.trim() === '' && r.url.trim() === '') continue;
      if (r.label.trim() === '' || r.url.trim() === '') {
        setRowsError('برای هر دکمه، هم عنوان و هم نشانی را وارد کنید یا ردیف خالی را حذف کنید.');
        return false;
      }
      try {
        new URL(r.url.trim());
      } catch {
        setRowsError(`نشانی دکمهٔ «${r.label.trim()}» معتبر نیست (مثال: https://example.com).`);
        return false;
      }
    }
    setRowsError('');
    return true;
  };

  const createPost = useCallback(async (): Promise<string | null> => {
    const payload: Record<string, unknown> = { body: body };
    if (title.trim()) payload.title = title.trim();
    if (media) payload.mediaId = media.id;
    if (!buttonsDisabled && validRows.length > 0) {
      payload.buttons = { inline: validRows.map((r) => ({ label: r.label, url: r.url })) };
    }
    const data = await api.post<{ post: { id: string } }>('/api/v1/posts', payload);
    return data.post?.id ?? null;
  }, [body, title, media, validRows, buttonsDisabled]);

  const guard = (): boolean => {
    if (body.trim() === '') {
      toast.error('متن پست را وارد کنید.');
      return false;
    }
    if (selectedIds.length === 0) {
      toast.error('حداقل یک کانال برای انتشار انتخاب کنید.');
      return false;
    }
    if (!validateRows()) return false;
    return true;
  };

  const publishNow = async () => {
    if (!guard()) return;
    setPublishing(true);
    try {
      const id = await createPost();
      if (!id) throw new ApiRequestError('UNKNOWN', 'ساخت پست ناموفق بود.', 500);
      await api.post(`/api/v1/posts/${id}/publish`, { channelIds: selectedIds });
      toast.success('پست برای انتشار ارسال شد و در صف پردازش قرار گرفت.');
      navigate(`/dashboard/posts/${id}`);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setPublishing(false);
    }
  };

  const schedule = async () => {
    if (!guard()) return;
    if (!scheduledAt) {
      toast.error('تاریخ و ساعت انتشار را مشخص کنید.');
      return;
    }
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error('زمان انتشار باید در آینده باشد.');
      return;
    }
    setScheduling(true);
    try {
      const id = await createPost();
      if (!id) throw new ApiRequestError('UNKNOWN', 'ساخت پست ناموفق بود.', 500);
      await api.post(`/api/v1/posts/${id}/schedule`, { channelIds: selectedIds, scheduledAt: when.toISOString() });
      toast.success('پست با موفقیت زمان‌بندی شد.');
      navigate(`/dashboard/posts/${id}`);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setScheduling(false);
    }
  };

  if (channels === null) return <PageLoading />;

  if (activeChannels.length === 0) {
    return (
      <EmptyState
        icon="📻"
        title="کانال فعالی ندارید"
        description="برای ساخت و انتشار پست، ابتدا یک کانال فعال در بخش مدیریت کانال‌ها ثبت کنید."
        action={<a href="/dashboard/channels" className="btn btn-primary">رفتن به مدیریت کانال‌ها</a>}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 860 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>ساخت پست جدید</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>متن پست را بنویسید، رسانه پیوست کنید و کانال‌های مقصد را انتخاب کنید.</p>
      </div>

      <Card pad="lg">
        <Field label="عنوان (اختیاری)">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={190} placeholder="عنوان پست" />
        </Field>
        <Field label="متن پست" required hint={`${faDigits(body.length)} از ${faDigits(MAX_BODY)} نویسه`}>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            maxLength={MAX_BODY}
            placeholder="متن پست را اینجا بنویسید…"
            aria-label="متن پست"
          />
        </Field>

        <Field label="رسانه (تصویر یا ویدیو)" hint="حداکثر ۸ مگابایت — تصویر JPG/PNG/WebP/GIF یا ویدیو MP4">
          {media ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt={`پیش‌نمایش ${media.filename}`}
                  style={{ maxWidth: 260, maxHeight: 180, borderRadius: 10, border: '1px solid var(--border)' }}
                />
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
                <span dir="ltr" style={{ color: 'var(--text-2)' }}>{media.filename}</span>
                <span style={{ color: 'var(--text-2)' }}>({faNumber(media.sizeBytes)} بایت)</span>
                <Button size="sm" variant="ghost" onClick={removeMedia}>حذف رسانه</Button>
              </div>
            </div>
          ) : (
            <label className="btn btn-ghost" style={{ justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer' }}>
              {uploading ? <Spinner /> : '📎 انتخاب فایل'}
              <input
                type="file"
                accept="image/*,video/mp4"
                style={{ display: 'none' }}
                disabled={uploading}
                onChange={(e) => {
                  void onFilePicked(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </Field>
      </Card>

      <Card pad="lg">
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>انتخاب کانال‌های مقصد</h3>
        <div role="group" aria-label="کانال‌های مقصد" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {activeChannels.map((ch) => (
            <label
              key={ch.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                border: `1px solid ${selectedIds.includes(ch.id) ? 'var(--brand)' : 'var(--border)'}`,
                borderRadius: 10, cursor: 'pointer', background: selectedIds.includes(ch.id) ? 'var(--brand-soft)' : 'var(--surface)',
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(ch.id)}
                onChange={() => toggleChannel(ch.id)}
                style={{ width: 16, height: 16, accentColor: 'var(--brand)' }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-2)' }}>{PLATFORM_FA[ch.platform]}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card pad="lg">
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>دکمه‌های شیشه‌ای (لینک)</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-2)' }}>
          می‌توانید به پست خود حداکثر {faDigits(8)} دکمه با نشانی اینترنتی اضافه کنید.
        </p>

        {anySelectedWithoutButtons && (
          <div style={{ background: 'var(--warning-soft)', color: '#92400e', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, marginBottom: 10 }}>
            روبیکا: دکمه پشتیبانی نمی‌شود؛ دکمه‌ها هنگام ارسال به کانال‌های روبیکا حذف خواهند شد.
          </div>
        )}

        <div style={{ display: 'grid', gap: 10, opacity: buttonsDisabled ? 0.5 : 1, pointerEvents: buttonsDisabled ? 'none' : 'auto' }}>
          {rows.map((row, idx) => (
            <div key={idx} style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1.4fr auto', alignItems: 'start' }}>
              <Input
                value={row.label}
                onChange={(e) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r)))}
                placeholder="عنوان دکمه"
                aria-label="عنوان دکمه"
                maxLength={64}
              />
              <Input
                dir="ltr"
                value={row.url}
                onChange={(e) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, url: e.target.value } : r)))}
                placeholder="https://example.com"
                aria-label="نشانی دکمه"
                maxLength={255}
              />
              <Button variant="ghost" size="sm" onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))} aria-label="حذف دکمه">
                حذف
              </Button>
            </div>
          ))}
          {rows.length < 8 && (
            <div>
              <Button variant="soft" size="sm" onClick={() => setRows((prev) => [...prev, { label: '', url: '' }])}>
                + افزودن دکمه
              </Button>
            </div>
          )}
        </div>
        {rowsError && <div className="field-error" role="alert" style={{ marginTop: 8 }}>{rowsError}</div>}
      </Card>

      <Card pad="lg">
        <Field label="تاریخ و ساعت انتشار (برای زمان‌بندی)" hint="این فیلد فقط برای «زمان‌بندی» استفاده می‌شود.">
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          <Button onClick={() => void publishNow()} loading={publishing}>🚀 انتشار فوری</Button>
          <Button variant="soft" onClick={() => void schedule()} loading={scheduling}>⏰ زمان‌بندی</Button>
        </div>
      </Card>
    </div>
  );
}
