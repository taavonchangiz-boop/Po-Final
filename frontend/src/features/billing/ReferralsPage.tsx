import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Gift, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { Stat } from '../../components/ui/Stat';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { usePageTitle } from '../../app/usePageTitle';
import { get } from '../../lib/api';
import { faMoney, faDate } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { errorMessage, ErrorCard } from '../publishing/parts';

/**
 * Referrals — code, invited users and total rewards.
 * Shape verified against app/src/modules/billing/referral.service.ts:
 *  GET /referrals → { code (string|null), referred: [{ name (first name +
 *  last-name initial — privacy), status: 'PENDING'|'REWARDED'|'REJECTED',
 *  rewardAmount, createdAt }], totalRewarded }.
 * Reward semantics: the referrer is credited on the referred user's FIRST
 * verified payment (referral.service.rewardIfEligible).
 */

interface ReferralPerson {
  name?: string;
  status?: string;
  rewardAmount?: number | null;
  createdAt?: string;
}

interface ReferralResponse {
  code?: string | null;
  referred?: ReferralPerson[];
  totalRewarded?: number;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'در انتظار',
  REWARDED: 'پاداش داده شد',
  REJECTED: 'رد شده',
};

const STATUS_TONES: Record<string, 'info' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'info',
  REWARDED: 'success',
  REJECTED: 'danger',
};

export default function ReferralsPage() {
  usePageTitle('دعوت دوستان');
  const pushToast = useUiStore((s) => s.pushToast);
  const [copied, setCopied] = useState(false);

  const referrals = useQuery({
    queryKey: ['referrals'],
    queryFn: () => get<ReferralResponse>('/referrals'),
  });

  const code = referrals.data?.code ?? null;
  const shareText = code
    ? `من در پُست‌یار محتوایم را یک‌جا به تلگرام، بله و روبیکا منتشر می‌کنم. با کد دعوت «${code}» ثبت‌نام کن: ${typeof window !== 'undefined' ? window.location.origin : ''}`
    : '';

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast('error', 'کپی در کلیپ‌بورد ممکن نشد؛ کد را دستی یادداشت کنید.');
    }
  }

  return (
    <>
      <PageHeader
        title="دعوت دوستان"
        description="با معرفی پُست‌یار، روی اولین پرداخت هر کاربر جدید پاداش بگیرید"
      />

      <div className="space-y-6">
        {referrals.error ? (
          <ErrorCard message={errorMessage(referrals.error)} onRetry={() => void referrals.refetch()} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Code card */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus aria-hidden="true" className="size-4 text-primary-700" />
                  کد دعوت شما
                </CardTitle>
              </CardHeader>
              <CardBody>
                {referrals.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-12 w-48" />
                    <Skeleton className="h-10 w-32" />
                  </div>
                ) : !code ? (
                  <p className="text-sm text-neutral-500">کد دعوت برای حساب شما تولید نشده است؛ با پشتیبانی تماس بگیرید.</p>
                ) : (
                  <div className="space-y-4">
                    <p
                      dir="ltr"
                      className="inline-flex items-center rounded-xl border-2 border-dashed border-primary-300 bg-primary-50 px-5 py-3 text-2xl font-bold tracking-widest text-primary-800"
                    >
                      {code}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button onClick={() => void copyCode()}>
                        {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
                        {copied ? 'کپی شد' : 'کپی کد + متن دعوت'}
                      </Button>
                    </div>
                    <p className="text-xs leading-6 text-neutral-500">
                      متن دعوت شامل کد شما و نشانی سایت است؛ کافی است آن را در تلگرام یا بله برای دوستانتان بفرستید.
                    </p>
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Total rewarded */}
            <Stat
              className="h-fit"
              label="مجموع پاداش‌های دریافتی"
              value={referrals.isLoading ? <Skeleton className="h-7 w-28" /> : faMoney(referrals.data?.totalRewarded ?? 0)}
              icon={Gift}
              hint="واریز خودکار به کیف پول"
            />
          </div>
        )}

        {/* How it works */}
        <Card>
          <CardHeader>
            <CardTitle>چطور کار می‌کند؟</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="grid gap-3 sm:grid-cols-3">
              <li className="rounded-xl border border-neutral-200 p-4">
                <p className="text-sm font-bold text-primary-800">۱. به اشتراک بگذارید</p>
                <p className="mt-1 text-xs leading-6 text-neutral-500">کد دعوت یا متن آمادهٔ دعوت را با دوستانتان در میان بگذارید.</p>
              </li>
              <li className="rounded-xl border border-neutral-200 p-4">
                <p className="text-sm font-bold text-primary-800">۲. دوست شما ثبت‌نام می‌کند</p>
                <p className="mt-1 text-xs leading-6 text-neutral-500">کد شما در فرم ثبت‌نام وارد می‌شود و حساب او به شما متصل می‌گردد.</p>
              </li>
              <li className="rounded-xl border border-neutral-200 p-4">
                <p className="text-sm font-bold text-primary-800">۳. پاداش واریز می‌شود</p>
                <p className="mt-1 text-xs leading-6 text-neutral-500">با اولین پرداخت تأییدشدهٔ کاربر معرفی‌شده، پاداش به کیف پول شما اضافه می‌شود.</p>
              </li>
            </ol>
          </CardBody>
        </Card>

        {/* Invited users */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-neutral-900">کاربران معرفی‌شده</h2>
          {referrals.isLoading ? (
            <Card>
              <CardBody className="space-y-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </CardBody>
            </Card>
          ) : referrals.error ? (
            <ErrorCard message={errorMessage(referrals.error)} onRetry={() => void referrals.refetch()} />
          ) : (referrals.data?.referred ?? []).length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="هنوز کسی را معرفی نکرده‌اید"
              description="اولین دعوت را بفرستید؛ به‌محض اولین پرداخت کاربر معرفی‌شده، پاداش شما واریز می‌شود."
            />
          ) : (
            <Table caption="کاربران معرفی‌شده و وضعیت پاداش">
              <THead>
                <TR>
                  <TH>نام</TH>
                  <TH>وضعیت</TH>
                  <TH>مبلغ پاداش</TH>
                  <TH>تاریخ عضویت</TH>
                </TR>
              </THead>
              <TBody>
                {(referrals.data?.referred ?? []).map((person, index) => (
                  <TR key={index}>
                    <TD className="font-medium text-neutral-900">{person.name || '—'}</TD>
                    <TD>
                      <Badge tone={STATUS_TONES[person.status ?? ''] ?? 'neutral'}>
                        {STATUS_LABELS[person.status ?? ''] ?? person.status}
                      </Badge>
                    </TD>
                    <TD>
                      {person.status === 'REWARDED' && typeof person.rewardAmount === 'number'
                        ? faMoney(person.rewardAmount)
                        : '—'}
                    </TD>
                    <TD className="text-xs text-neutral-500">{faDate(person.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}
