import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Languages, Lock, Save, ShieldAlert, Trash2, UserCog } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Dialog } from '../../components/ui/Dialog';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { usePageTitle } from '../../app/usePageTitle';
import { get, patch, post, ApiError } from '../../lib/api';
import { useUiStore } from '../../store/ui';
import { ME_QUERY_KEY } from '../../app/guards';
import { errorMessage } from '../publishing/parts';

/**
 * Settings — profile fields, password change, static locale rows, honest danger
 * zone. Verified against app/src/modules/users/users.routes.ts +
 * auth/auth.routes.ts:
 *  - GET /profile → { profile: { id, firstName, lastName, email, mobile,
 *    businessName, businessType, role, status, referralCode, createdAt } | null }.
 *  - PATCH /profile { firstName?, lastName?, businessName?, businessType? }
 *    → { profile, message } — email/mobile deliberately NOT editable (no
 *    verification flow in v1).
 *  - POST /auth/change-password { currentPassword, newPassword } → other
 *    sessions are invalidated server-side (auth.service.changePassword).
 *  - There is NO sessions-list endpoint and NO account-delete endpoint — those
 *    cards are omitted / replaced with an honest contact-support dialog.
 */

interface ProfileRecord {
  id?: number | string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  mobile?: string;
  businessName?: string | null;
  businessType?: string | null;
}

interface ProfileResponse {
  profile?: ProfileRecord | null;
}

const NAME_REGEX = /^[\u0600-\u06FF\u200ca-zA-Z\s]{2,100}$/;

export default function SettingsPage() {
  usePageTitle('تنظیمات');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => get<ProfileResponse>('/profile'),
  });

  /* --------------------------------- profile -------------------------------- */
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const p = profile.data?.profile;
    if (p && !loaded) {
      setFirstName(p.firstName ?? '');
      setLastName(p.lastName ?? '');
      setBusinessName(p.businessName ?? '');
      setBusinessType(p.businessType ?? '');
      setLoaded(true);
    }
  }, [profile.data, loaded]);

  const saveProfileMutation = useMutation({
    mutationFn: () =>
      patch<{ message?: string }>('/profile', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        businessName: businessName.trim(),
        businessType: businessType.trim(),
      }),
    onSuccess: (data) => {
      pushToast('success', data?.message ?? 'پروفایل با موفقیت بروزرسانی شد.');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  function submitProfile() {
    const errors: Record<string, string> = {};
    if (!NAME_REGEX.test(firstName.trim())) errors.firstName = 'نام معتبر نیست (حداقل ۲ حرف).';
    if (!NAME_REGEX.test(lastName.trim())) errors.lastName = 'نام خانوادگی معتبر نیست (حداقل ۲ حرف).';
    if (businessName.trim().length < 2 || businessName.trim().length > 190)
      errors.businessName = 'نام کسب‌وکار بین ۲ تا ۱۹۰ کاراکتر باشد.';
    if (businessType.trim().length < 2 || businessType.trim().length > 100)
      errors.businessType = 'نوع فعالیت بین ۲ تا ۱۰۰ کاراکتر باشد.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    saveProfileMutation.mutate();
  }

  /* ----------------------------- password change ----------------------------- */
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  function submitPassword() {
    const errors: Record<string, string> = {};
    if (!currentPassword) errors.currentPassword = 'رمز فعلی را وارد کنید.';
    if (newPassword.length < 8) errors.newPassword = 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.';
    if (newPassword === currentPassword && newPassword.length > 0)
      errors.newPassword = 'رمز جدید باید با رمز فعلی متفاوت باشد.';
    if (newPasswordConfirm !== newPassword) errors.newPasswordConfirm = 'تکرار رمز با رمز جدید یکسان نیست.';
    setPasswordErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setConfirmOpen(true);
  }

  const changePasswordMutation = useMutation({
    mutationFn: () =>
      post<{ message?: string }>('/auth/change-password', {
        currentPassword,
        newPassword,
      }),
    onSuccess: (data) => {
      pushToast('success', data?.message ?? 'رمز عبور با موفقیت تغییر کرد.');
      setConfirmOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
    },
    onError: (e: unknown) => {
      setConfirmOpen(false);
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });

  /* ------------------------------ danger zone ------------------------------- */
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const p = profile.data?.profile;

  return (
    <>
      <PageHeader title="تنظیمات" description="پروفایل، امنیت حساب و ترجیحات" />

      {profile.error ? (
        <div className="mb-6">
          <EmptyState
            icon={UserCog}
            title="بارگذاری تنظیمات ناموفق بود"
            description={errorMessage(profile.error)}
            action={<Button onClick={() => void profile.refetch()}>تلاش مجدد</Button>}
          />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* --------------------------------- profile -------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog aria-hidden="true" className="size-4 text-primary-700" />
              پروفایل
            </CardTitle>
          </CardHeader>
          <CardBody>
            {profile.isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="نام"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    error={fieldErrors.firstName}
                  />
                  <Input
                    label="نام خانوادگی"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    error={fieldErrors.lastName}
                  />
                </div>
                <Input
                  label="نام کسب‌وکار"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  error={fieldErrors.businessName}
                />
                <Input
                  label="نوع فعالیت"
                  required
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  error={fieldErrors.businessType}
                  hint="مثلاً فروشگاهی، آموزشی، رسانه‌ای"
                />
                {/* display-only contact fields (no verification flow in v1) */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-neutral-700">
                      <Lock aria-hidden="true" className="size-3.5 text-neutral-400" />
                      شماره موبایل
                    </p>
                    <p dir="ltr" className="rounded-xl border border-neutral-100 bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-500">
                      {p?.mobile || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-neutral-700">
                      <Lock aria-hidden="true" className="size-3.5 text-neutral-400" />
                      ایمیل
                    </p>
                    <p dir="ltr" className="rounded-xl border border-neutral-100 bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-500">
                      {p?.email || '—'}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-neutral-400">تغییر شماره موبایل و ایمیل در این نسخه امکان‌پذیر نیست.</p>
                <Button loading={saveProfileMutation.isPending} onClick={submitProfile}>
                  <Save aria-hidden="true" className="size-4" />
                  ذخیره تغییرات
                </Button>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="space-y-6">
          {/* ----------------------------- password change ---------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>تغییر رمز عبور</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <Input
                label="رمز فعلی"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                error={passwordErrors.currentPassword}
                required
              />
              <Input
                label="رمز جدید"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                error={passwordErrors.newPassword}
                hint="حداقل ۸ کاراکتر"
                required
              />
              <Input
                label="تکرار رمز جدید"
                type="password"
                autoComplete="new-password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                error={passwordErrors.newPasswordConfirm}
                required
              />
              <Button loading={changePasswordMutation.isPending} onClick={submitPassword}>
                تغییر رمز عبور
              </Button>
            </CardBody>
          </Card>

          {/* ----------------------------- appearance / locale ------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle>نمایش و زبان</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="divide-y divide-neutral-100 text-sm">
                <li className="flex items-center justify-between gap-3 py-3">
                  <span className="flex items-center gap-2 text-neutral-600">
                    <Languages aria-hidden="true" className="size-4 text-neutral-400" />
                    زبان رابط کاربری
                  </span>
                  <span className="font-medium text-neutral-900">فارسی</span>
                </li>
                <li className="flex items-center justify-between gap-3 py-3">
                  <span className="flex items-center gap-2 text-neutral-600">
                    <Globe aria-hidden="true" className="size-4 text-neutral-400" />
                    منطقه زمانی
                  </span>
                  <span className="font-medium text-neutral-900">تهران (UTC+۰۳:۳۰)</span>
                </li>
                <li className="flex items-center justify-between gap-3 py-3">
                  <span className="flex items-center gap-2 text-neutral-600">
                    <Globe aria-hidden="true" className="size-4 text-neutral-400" />
                    تقویم
                  </span>
                  <span className="font-medium text-neutral-900">هجری شمسی</span>
                </li>
              </ul>
            </CardBody>
          </Card>

          {/* -------------------------------- danger zone ------------------------------ */}
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700">
                <ShieldAlert aria-hidden="true" className="size-4" />
                ناحیهٔ خطر
              </CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-sm leading-6 text-neutral-600">
                حذف حساب، تمام کانال‌ها، ربات‌ها و تاریخچهٔ انتشار را غیرقابل بازیابی می‌کند. این کار از طریق پشتیبانی انجام می‌شود.
              </p>
              <Button variant="danger" className="mt-4" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 aria-hidden="true" className="size-4" />
                حذف حساب
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* password-change confirm */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => changePasswordMutation.mutate()}
        loading={changePasswordMutation.isPending}
        title="تغییر رمز عبور"
        description="پس از تغییر رمز، سایر نشست‌های فعال شما خاتمه می‌یابد و باید در آن دستگاه‌ها دوباره وارد شوید."
        confirmLabel="تغییر رمز"
      />

      {/* delete-account dialog (honest: no delete endpoint — contact support) */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="حذف حساب کاربری"
        size="sm"
        footer={
          <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
            بستن
          </Button>
        }
      >
        <p className="text-sm leading-7 text-neutral-700">
          حذف کامل حساب از داخل پنل امکان‌پذیر نیست تا از حذف‌های تصادفی جلوگیری شود. برای حذف حساب، از بخش{' '}
          <Link to="/app/support" className="font-medium text-primary-700 hover:underline">
            پشتیبانی
          </Link>{' '}
          تیکت بزنید؛ پس از تأیید هویت، حساب و داده‌های شما طبق سیاست نگهداری داده حذف می‌شود.
        </p>
      </Dialog>
    </>
  );
}
