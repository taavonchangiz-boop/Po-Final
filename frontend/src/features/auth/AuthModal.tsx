import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Tabs } from '../../components/ui/Tabs';
import { post, ApiError } from '../../lib/api';
import { toEn } from '../../lib/format';
import { ME_QUERY_KEY } from '../../app/guards';
import { useUiStore } from '../../store/ui';

/**
 * Auth modal — real calls to POST /api/v1/auth/login and POST /api/v1/auth/register.
 * On success: invalidate the /me query, close the modal, navigate to /app.
 */

interface LoginPayload {
  phone: string;
  password: string;
}

interface RegisterPayload {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  businessName?: string;
  activityType?: string;
  password: string;
  passwordConfirm: string;
  acceptTerms: boolean;
  referralCode?: string;
}

const GENERIC_ERROR = 'خطای غیرمنتظره رخ داد؛ دوباره تلاش کنید.';

function normalizePhone(raw: string): string {
  let v = toEn(raw).replace(/[^\d+]/g, '');
  if (v.startsWith('+98')) v = '0' + v.slice(3);
  else if (v.startsWith('0098')) v = '0' + v.slice(4);
  else if (v.startsWith('98') && v.length >= 12) v = '0' + v.slice(2);
  return v.replace(/\D/g, '');
}

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : GENERIC_ERROR;
}

export function AuthModalHost() {
  const authModalOpen = useUiStore((s) => s.authModalOpen);
  const authModalMode = useUiStore((s) => s.authModalMode);
  const closeAuthModal = useUiStore((s) => s.closeAuthModal);
  const setAuthModalMode = useUiStore((s) => s.setAuthModalMode);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [serverError, setServerError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Login fields
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  // Register fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [email, setEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [activityType, setActivityType] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  useEffect(() => {
    if (authModalOpen) {
      setServerError('');
      setFieldErrors({});
    }
  }, [authModalOpen, authModalMode]);

  async function handleAuthSuccess() {
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    closeAuthModal();
    navigate('/app', { replace: true });
  }

  const loginMutation = useMutation({
    mutationFn: (payload: LoginPayload) => post('/auth/login', payload),
    onSuccess: () => {
      void handleAuthSuccess();
    },
    onError: (e) => setServerError(errorMessage(e)),
  });

  const registerMutation = useMutation({
    mutationFn: (payload: RegisterPayload) => post('/auth/register', payload),
    onSuccess: () => {
      void handleAuthSuccess();
    },
    onError: (e) => setServerError(errorMessage(e)),
  });

  function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError('');
    const errors: Record<string, string> = {};
    const normalized = normalizePhone(phone);
    if (!/^09\d{9}$/.test(normalized)) {
      errors.phone = 'شماره موبایل معتبر وارد کنید. (مثال: ۰۹۱۲۳۴۵۶۷۸۹)';
    }
    if (!password) errors.password = 'رمز عبور را وارد کنید.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    loginMutation.mutate({ phone: normalized, password });
  }

  function handleRegisterSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError('');
    const errors: Record<string, string> = {};
    if (!firstName.trim()) errors.firstName = 'نام را وارد کنید.';
    if (!lastName.trim()) errors.lastName = 'نام خانوادگی را وارد کنید.';
    const normalized = normalizePhone(regPhone);
    if (!/^09\d{9}$/.test(normalized)) {
      errors.phone = 'شماره موبایل معتبر وارد کنید. (مثال: ۰۹۱۲۳۴۵۶۷۸۹)';
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = 'قالب ایمیل صحیح نیست.';
    }
    if (regPassword.length < 8) errors.password = 'رمز عبور باید حداقل ۸ کاراکتر باشد.';
    if (passwordConfirm !== regPassword) errors.passwordConfirm = 'تکرار رمز عبور با رمز عبور یکسان نیست.';
    if (!acceptTerms) errors.acceptTerms = 'پذیرش قوانین و مقررات الزامی است.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    registerMutation.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: normalized,
      email: trimmedEmail || undefined,
      businessName: businessName.trim() || undefined,
      activityType: activityType.trim() || undefined,
      password: regPassword,
      passwordConfirm,
      acceptTerms: true,
      referralCode: referralCode.trim() || undefined,
    });
  }

  return (
    <Dialog
      open={authModalOpen}
      onClose={closeAuthModal}
      title="ورود به پُستیار"
      description="برای مدیریت انتشار محتوا وارد حساب خود شوید یا ثبت‌نام کنید."
      size="md"
    >
      <Tabs
        ariaLabel="ورود یا ثبت‌نام"
        items={[
          { key: 'login', label: 'ورود' },
          { key: 'register', label: 'ثبت‌نام' },
        ]}
        active={authModalMode}
        onChange={(key) => {
          setAuthModalMode(key === 'register' ? 'register' : 'login');
          setServerError('');
          setFieldErrors({});
        }}
        className="mb-5"
      />

      {serverError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{serverError}</span>
        </div>
      )}

      {authModalMode === 'login' ? (
        <form onSubmit={handleLoginSubmit} noValidate className="space-y-4">
          <Input
            label="شماره موبایل"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            placeholder="09123456789"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={fieldErrors.phone}
            required
          />
          <Input
            label="رمز عبور"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            required
          />
          <Button type="submit" className="w-full" loading={loginMutation.isPending}>
            ورود
          </Button>
          <p className="text-center text-xs text-neutral-500">
            حساب ندارید؟{' '}
            <button
              type="button"
              onClick={() => setAuthModalMode('register')}
              className="focus-ring rounded font-medium text-primary-700 hover:underline"
            >
              ثبت‌نام کنید
            </button>
          </p>
        </form>
      ) : (
        <form onSubmit={handleRegisterSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="نام"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              error={fieldErrors.firstName}
              required
            />
            <Input
              label="نام خانوادگی"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              error={fieldErrors.lastName}
              required
            />
          </div>
          <Input
            label="شماره موبایل"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            placeholder="09123456789"
            value={regPhone}
            onChange={(e) => setRegPhone(e.target.value)}
            error={fieldErrors.phone}
            required
          />
          <Input
            label="ایمیل"
            type="email"
            dir="ltr"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
            hint="اختیاری"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="نام کسب‌وکار"
              autoComplete="organization"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              hint="اختیاری"
            />
            <Input
              label="نوع فعالیت"
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
              hint="اختیاری؛ مثلاً فروشگاهی، آموزشی"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="رمز عبور"
              type="password"
              autoComplete="new-password"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              error={fieldErrors.password}
              hint="حداقل ۸ کاراکتر"
              required
            />
            <Input
              label="تکرار رمز عبور"
              type="password"
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              error={fieldErrors.passwordConfirm}
              required
            />
          </div>
          <Input
            label="کد دعوت"
            dir="ltr"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            hint="اختیاری؛ اگر از دوستی دعوت شده‌اید کد او را وارد کنید"
          />
          <div>
            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="focus-ring mt-0.5 size-4 rounded border-neutral-300 accent-teal-700"
                aria-describedby={fieldErrors.acceptTerms ? 'accept-terms-error' : undefined}
              />
              <span>
                <span className="font-medium">قوانین و مقررات پُستیار</span> را می‌پذیرم.
              </span>
            </label>
            {fieldErrors.acceptTerms && (
              <p id="accept-terms-error" role="alert" className="mt-1.5 text-xs text-red-600">
                {fieldErrors.acceptTerms}
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" loading={registerMutation.isPending}>
            ثبت‌نام
          </Button>
          <p className="text-center text-xs text-neutral-500">
            حساب دارید؟{' '}
            <button
              type="button"
              onClick={() => setAuthModalMode('login')}
              className="focus-ring rounded font-medium text-primary-700 hover:underline"
            >
              وارد شوید
            </button>
          </p>
        </form>
      )}
    </Dialog>
  );
}
