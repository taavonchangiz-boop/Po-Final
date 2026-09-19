import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError, type ChannelDto } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageLoading, Select, StatusBadge } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { faDate, PLATFORM_FA } from '../../lib/format';

type Platform = ChannelDto['platform'];

const CHANNEL_STATE_FA: Record<string, string> = {
  PENDING_VERIFY: 'در انتظار تأیید',
  ACTIVE: 'فعال',
  DISABLED: 'غیرفعال',
  ERROR: 'خطا',
};

const PLATFORM_ICON: Record<Platform, string> = { telegram: '✈️', bale: '💠', rubika: '📱' };

/** Shape returned by GET /api/v1/channels/capabilities?platform=X */
interface CapabilitiesDto {
  sendText: boolean;
  sendMedia: boolean;
  editMessage: boolean;
  deleteMessage: boolean;
  inlineButtons: boolean;
  htmlParseMode: boolean;
}

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

/** Persian capability hints shown in the connect modal (negatives matter most). */
function capabilityHints(c: CapabilitiesDto): string[] {
  const hints: string[] = [];
  hints.push(c.sendText ? 'ارسال متن پشتیبانی می‌شود.' : 'ارسال متن پشتیبانی نمی‌شود.');
  hints.push(c.sendMedia ? 'ارسال تصویر و ویدیو پشتیبانی می‌شود.' : 'ارسال تصویر و ویدیو پشتیبانی نمی‌شود.');
  if (!c.inlineButtons) hints.push('دکمه شیشه‌ای (لینک) پشتیبانی نمی‌شود.');
  if (!c.deleteMessage) hints.push('حذف پیام پشتیبانی نمی‌شود.');
  if (!c.editMessage) hints.push('ویرایش پیام پس از ارسال پشتیبانی نمی‌شود.');
  if (!c.htmlParseMode) hints.push('قالب‌بندی پیشرفتهٔ متن (اچ‌تی‌ام‌ال) پشتیبانی نمی‌شود.');
  return hints;
}

export default function Channels() {
  const toast = useToast();
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [loading, setLoading] = useState(true);

  // connect modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>('telegram');
  const [channelRef, setChannelRef] = useState('');
  const [title, setTitle] = useState('');
  const [caps, setCaps] = useState<CapabilitiesDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // action state
  const [busyId, setBusyId] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<ChannelDto | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ channels: ChannelDto[] }>('/api/v1/channels');
      setChannels(data.channels ?? []);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fetch live capabilities whenever the selected platform changes in the modal.
  useEffect(() => {
    if (!modalOpen) return;
    let cancelled = false;
    setCaps(null);
    api
      .get<{ platform: string; capabilities: CapabilitiesDto }>(`/api/v1/channels/capabilities?platform=${platform}`)
      .then((d) => {
        if (!cancelled) setCaps(d.capabilities);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [modalOpen, platform]);

  const openModal = () => {
    setPlatform('telegram');
    setChannelRef('');
    setTitle('');
    setFormError('');
    setModalOpen(true);
  };

  const submitConnect = async () => {
    const ref = channelRef.trim();
    if (!ref) {
      setFormError('آدرس کانال را وارد کنید.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/api/v1/channels', { platform, channelRef: ref, title: title.trim() || ref });
      toast.success('کانال ثبت شد و در انتظار تأیید است.');
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const verifyChannel = async (ch: ChannelDto) => {
    setBusyId(ch.id);
    try {
      await api.post(`/api/v1/channels/${ch.id}/verify`);
      toast.success(`وضعیت «${ch.title}» به‌روزرسانی شد.`);
      await load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusyId('');
    }
  };

  const disconnect = async () => {
    if (!confirmTarget) return;
    setRemoving(true);
    try {
      await api.del(`/api/v1/channels/${confirmTarget.id}`);
      toast.success(`کانال «${confirmTarget.title}» قطع شد.`);
      setConfirmTarget(null);
      await load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>مدیریت کانال‌ها</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>
            کانال‌های متصل به حساب شما برای انتشار پست
          </p>
        </div>
        <Button onClick={openModal}>+ اتصال کانال جدید</Button>
      </div>

      {channels.length === 0 ? (
        <EmptyState
          icon="📻"
          title="هنوز کانالی متصل نکرده‌اید"
          description="اولین کانال خود را از تلگرام، بله یا روبیکا متصل کنید تا بتوانید پست منتشر کنید."
          action={<Button onClick={openModal}>اتصال کانال</Button>}
        />
      ) : (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {channels.map((ch) => (
            <Card key={ch.id} pad="lg">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span aria-hidden="true" style={{ fontSize: 24 }}>{PLATFORM_ICON[ch.platform] ?? '📻'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</div>
                  <div dir="ltr" style={{ textAlign: 'right', fontSize: 12.5, color: 'var(--text-2)' }}>{ch.channelRef}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <StatusBadge state={ch.status} labels={CHANNEL_STATE_FA} />
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{PLATFORM_FA[ch.platform]}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>تاریخ افزودن: {faDate(ch.createdAt)}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ch.status !== 'ACTIVE' && (
                  <Button size="sm" variant="soft" loading={busyId === ch.id} onClick={() => void verifyChannel(ch)}>
                    بررسی و تأیید
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setConfirmTarget(ch)}>
                  قطع اتصال
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="اتصال کانال جدید">
        <Field label="پلتفرم" required>
          <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            <option value="telegram">تلگرام</option>
            <option value="bale">بله</option>
            <option value="rubika">روبیکا</option>
          </Select>
        </Field>
        <Field label="آدرس کانال" required hint="مثال: @mychannel" error={formError || undefined}>
          <Input
            dir="ltr"
            value={channelRef}
            error={Boolean(formError)}
            onChange={(e) => setChannelRef(e.target.value)}
            placeholder="@mychannel"
          />
        </Field>
        <Field label="نام نمایشی کانال" hint="اگر خالی بماند، همان آدرس کانال استفاده می‌شود.">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: کانال اخبار فروشگاه" />
        </Field>

        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>قابلیت‌های {PLATFORM_FA[platform]}:</div>
          {caps ? (
            <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: 'var(--text-2)', display: 'grid', gap: 2 }}>
              {capabilityHints(caps).map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>در حال دریافت قابلیت‌ها…</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Button onClick={() => void submitConnect()} loading={saving}>ثبت کانال</Button>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>انصراف</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => void disconnect()}
        busy={removing}
        danger
        title="قطع اتصال کانال"
        message={`آیا از قطع اتصال کانال «${confirmTarget?.title ?? ''}» مطمئن هستید؟ این کانال دیگر برای انتشار پست استفاده نخواهد شد.`}
      />
    </div>
  );
}
