import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiRequestError, avatarPhotoUrl } from '../../lib/api';
import { Button, Card, Field, Input, Modal, PageLoading, Select } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Avatar, AVATAR_CHARACTERS } from '../../components/Avatar';

interface UserSettingsDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  businessName: string;
  businessType: string;
  timezone: string;
}

const BUSINESS_TYPES = ['شخصی', 'فروشگاهی', 'خدماتی', 'رسانه و محتوا', 'آموزشی', 'سایر'];

const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'Asia/Tehran', label: 'تهران' },
  { value: 'Asia/Dubai', label: 'دبی' },
  { value: 'Asia/Istanbul', label: 'استانبول' },
  { value: 'Europe/Berlin', label: 'برلین' },
  { value: 'UTC', label: 'ساعت جهانی (UTC)' },
];

const DELETE_PHRASE = 'حذف حساب قابل بازگشت نیست';

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

export default function Settings() {
  const toast = useToast();
  const navigate = useNavigate();
  const { me, refresh } = useAuth();

  /* Task 17-b: تصویر پروفایل — standard characters + custom photo upload. */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // (الف) account info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0]);
  const [timezone, setTimezone] = useState('Asia/Tehran');
  const [infoErrors, setInfoErrors] = useState<Record<string, string>>({});
  const [savingInfo, setSavingInfo] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(true);

  // (ب) change password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [savingPassword, setSavingPassword] = useState(false);

  // (ج) delete account
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<UserSettingsDto>('/api/v1/users/me/settings')
      .then((u) => {
        if (cancelled) return;
        setFirstName(u.firstName ?? '');
        setLastName(u.lastName ?? '');
        setBusinessName(u.businessName ?? '');
        setBusinessType(u.businessType || BUSINESS_TYPES[0]);
        setTimezone(u.timezone || 'Asia/Tehran');
      })
      .catch((e) => toast.error(errText(e)))
      .finally(() => {
        if (!cancelled) setLoadingInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveInfo = async () => {
    const errors: Record<string, string> = {};
    if (!firstName.trim()) errors.firstName = 'نام را وارد کنید.';
    if (!lastName.trim()) errors.lastName = 'نام خانوادگی را وارد کنید.';
    if (!businessName.trim()) errors.businessName = 'نام کسب‌وکار را وارد کنید.';
    setInfoErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSavingInfo(true);
    try {
      await api.put('/api/v1/users/me/settings', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        businessName: businessName.trim(),
        businessType: businessType.trim(),
        timezone,
      });
      toast.success('اطلاعات حساب با موفقیت ذخیره شد.');
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSavingInfo(false);
    }
  };

  const changePassword = async () => {
    const errors: Record<string, string> = {};
    if (!currentPassword) errors.currentPassword = 'رمز عبور فعلی را وارد کنید.';
    if (newPassword.length < 8) errors.newPassword = 'رمز جدید باید حداقل ۸ نویسه باشد.';
    else if (newPassword === currentPassword) errors.newPassword = 'رمز جدید باید با رمز فعلی متفاوت باشد.';
    if (confirmPassword !== newPassword) errors.confirmPassword = 'تکرار رمز جدید با رمز واردشده یکسان نیست.';
    setPwErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSavingPassword(true);
    try {
      await api.post('/api/v1/users/me/change-password', { currentPassword, newPassword });
      toast.success('رمز عبور با موفقیت تغییر کرد. لطفاً دوباره وارد شوید.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refresh();
      navigate('/?auth=login');
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSavingPassword(false);
    }
  };

  const deleteAccount = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await api.del<{ ok: boolean; message: string }>('/api/v1/users/me');
      toast.success(res.message || 'حساب شما حذف شد.');
      setDeleteOpen(false);
      await refresh();
      navigate('/');
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setDeleting(false);
    }
  }, [navigate, refresh, toast]);

  /* ---------------- avatar actions (Task 17-b) ---------------- */

  const pickCharacter = async (key: string) => {
    if (!me || busyKey) return;
    setBusyKey(key);
    try {
      await api.put('/api/v1/users/me/avatar/character', { value: key });
      await refresh();
      toast.success('تصویر پروفایل به‌روزرسانی شد.');
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusyKey(null);
    }
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.postForm('/api/v1/users/me/avatar', fd);
      await refresh();
      toast.success('تصویر شخصی بارگذاری شد.');
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('فقط فایل تصویری (JPG، PNG یا WebP) قابل قبول است.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('حجم تصویر باید حداکثر ۵ مگابایت باشد.');
      return;
    }
    void uploadPhoto(file);
  };

  const removePhoto = async () => {
    setRemoving(true);
    try {
      await api.del('/api/v1/users/me/avatar');
      await refresh();
      toast.success('تصویر شخصی حذف شد.');
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setRemoving(false);
    }
  };

  if (loadingInfo) return <PageLoading />;

  const avatarKind = me?.user.avatarKind ?? 'character';
  const avatarValue = me?.user.avatarValue ?? '';
  const avatarMediaId = me?.user.avatarMediaId ?? null;
  const photoUrl = avatarKind === 'photo' && me ? avatarPhotoUrl(me.user.id, avatarMediaId) : undefined;
  const fullName = me ? `${me.user.firstName} ${me.user.lastName}`.trim() : '';
  const activeCharacter = AVATAR_CHARACTERS.find((c) => c.key === avatarValue);
  const avatarBusy = busyKey !== null || uploading || removing;

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 780 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>تنظیمات حساب</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>مدیریت تصویر پروفایل، اطلاعات شخصی، رمز عبور و حساب کاربری</p>
      </div>

      {/* (۰) تصویر پروفایل — Task 17-b */}
      <Card pad="lg">
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>تصویر پروفایل</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
          <Avatar kind={avatarKind} value={avatarValue} photoUrl={photoUrl} name={fullName} size={72} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{fullName || 'کاربر پُست‌یار'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              {avatarKind === 'photo'
                ? 'تصویر شخصی شما فعال است.'
                : activeCharacter
                  ? `آواتار استاندارد «${activeCharacter.label}» فعال است.`
                  : 'یک آواتار استاندارد انتخاب کنید یا تصویر شخصی بارگذاری کنید.'}
            </div>
          </div>
        </div>
        <div className="pavatar-picker" role="radiogroup" aria-label="انتخاب آواتار استاندارد">
          {AVATAR_CHARACTERS.map((c) => {
            const active = avatarKind !== 'photo' && avatarValue === c.key;
            return (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={active}
                className={`pavatar-picker__tile${active ? ' is-active' : ''}`}
                disabled={avatarBusy}
                onClick={() => void pickCharacter(c.key)}
              >
                <Avatar kind="character" value={c.key} size={44} />
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onPickFile}
            aria-hidden="true"
            tabIndex={-1}
          />
          <Button variant="soft" loading={uploading} onClick={() => fileRef.current?.click()}>
            آپلود تصویر شخصی
          </Button>
          {avatarKind === 'photo' && (
            <Button variant="danger" loading={removing} onClick={() => void removePhoto()}>
              حذف تصویر شخصی
            </Button>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
            حداکثر ۵ مگابایت؛ تصویر مربعی‌شده و به WebP تبدیل می‌شود.
          </span>
        </div>
      </Card>

      <Card pad="lg">
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>اطلاعات حساب</h3>
        <div style={{ display: 'grid', gap: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <Field label="نام" required error={infoErrors.firstName}>
            <Input value={firstName} error={Boolean(infoErrors.firstName)} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="نام خانوادگی" required error={infoErrors.lastName}>
            <Input value={lastName} error={Boolean(infoErrors.lastName)} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <Field label="نام کسب‌وکار" required error={infoErrors.businessName}>
          <Input value={businessName} error={Boolean(infoErrors.businessName)} onChange={(e) => setBusinessName(e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gap: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <Field label="نوع فعالیت">
            <Select value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
              {BUSINESS_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="منطقهٔ زمانی">
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Button onClick={() => void saveInfo()} loading={savingInfo}>ذخیره تغییرات</Button>
      </Card>

      <Card pad="lg">
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>تغییر رمز عبور</h3>
        <Field label="رمز عبور فعلی" required error={pwErrors.currentPassword}>
          <Input
            type="password"
            value={currentPassword}
            error={Boolean(pwErrors.currentPassword)}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <div style={{ display: 'grid', gap: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <Field label="رمز عبور جدید" required error={pwErrors.newPassword} hint="حداقل ۸ نویسه">
            <Input
              type="password"
              value={newPassword}
              error={Boolean(pwErrors.newPassword)}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="تکرار رمز عبور جدید" required error={pwErrors.confirmPassword}>
            <Input
              type="password"
              value={confirmPassword}
              error={Boolean(pwErrors.confirmPassword)}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button onClick={() => void changePassword()} loading={savingPassword}>تغییر رمز عبور</Button>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
            پس از تغییر، همهٔ نشست‌های فعال شما خارج می‌شوند.
          </span>
        </div>
      </Card>

      <Card pad="lg" className="danger-zone">
        <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: 'var(--danger)' }}>حذف حساب</h3>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 14px', lineHeight: 2 }}>
          با حذف حساب، دسترسی شما به پُست‌یار غیرفعال و اطلاعات شناسایی شما ناشناس‌سازی می‌شود. این عمل قابل بازگشت نیست.
        </p>
        <Button variant="danger" onClick={() => { setDeletePhrase(''); setDeleteOpen(true); }}>
          حذف حساب کاربری
        </Button>
      </Card>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="حذف حساب کاربری">
        <p style={{ color: 'var(--text-2)', fontSize: 13.5, lineHeight: 2, marginBottom: 14 }}>
          این عملیات خطرناک است و قابل بازگشت نیست. برای تأیید، عبارت زیر را دقیقاً در کادر وارد کنید:
        </p>
        <div
          dir="rtl"
          style={{
            background: 'var(--danger-soft)', color: 'var(--danger)', fontWeight: 700,
            borderRadius: 10, padding: '8px 14px', marginBottom: 12, textAlign: 'center',
          }}
        >
          {DELETE_PHRASE}
        </div>
        <Field label="تایید عبارت" required>
          <Input
            value={deletePhrase}
            onChange={(e) => setDeletePhrase(e.target.value)}
            placeholder="عبارت تأیید را اینجا بنویسید"
            aria-label="تایید عبارت حذف حساب"
          />
        </Field>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <Button variant="danger" disabled={deletePhrase.trim() !== DELETE_PHRASE} loading={deleting} onClick={() => void deleteAccount()}>
            حذف قطعی حساب
          </Button>
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>انصراف</Button>
        </div>
      </Modal>
    </div>
  );
}
