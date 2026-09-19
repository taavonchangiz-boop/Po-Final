import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Landmark, WalletCards } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { get, post, ApiError } from '../../lib/api';
import { faMoney, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { errorMessage } from '../publishing/parts';

/**
 * Payment methods (task 10-d) — reusable billing bits driven by
 * GET /billing/payment-methods (admin settings: online gateway + card-to-card):
 *
 *  - GET /billing/payment-methods → { online: { enabled, gateway }, card: {
 *    enabled, number, holder } } — card info is present ONLY when enabled.
 *  - POST /payments/card { purpose: 'SUBSCRIPTION'|'WALLET_TOPUP', planId?,
 *    amount?, reference (4..64) } → 201 { paymentId, amount, status: 'PENDING' }
 *    — creates a manual payment awaiting admin approval.
 *
 * Used by WalletPage (inline in the topup dialog) and SubscriptionPage
 * (CardPaymentDialog per plan) — keep the shape stable for both.
 */

export interface PaymentMethodsResponse {
  online?: { enabled?: boolean; gateway?: string | null };
  card?: { enabled?: boolean; number?: string | null; holder?: string | null };
}

export interface CardPaymentInput {
  purpose: 'SUBSCRIPTION' | 'WALLET_TOPUP';
  planId?: number | string;
  amount?: number;
  reference: string;
}

export interface CardPaymentResponse {
  paymentId: number;
  amount: number;
  status: string;
}

/** Persian labels for the payment method toggle. */
export const paymentMethodLabels: Record<string, string> = {
  ONLINE: 'درگاه پرداخت آنلاین',
  CARD: 'کارت به کارت',
};

/** Client-side mirror of the backend reference validation (4..64 chars). */
export function validateReference(reference: string): string | null {
  const trimmed = reference.trim();
  if (trimmed.length < 4 || trimmed.length > 64) {
    return 'شماره پیگیری واریز باید بین ۴ تا ۶۴ کاراکتر باشد.';
  }
  return null;
}

/** Available payment methods (query enabled by default; auth required). */
export function usePaymentMethods() {
  return useQuery({
    queryKey: ['billing', 'payment-methods'],
    queryFn: () => get<PaymentMethodsResponse>('/billing/payment-methods'),
  });
}

/** POST /payments/card with shared toasts + history invalidation. */
export function useCardPayment(onSuccess?: (data: CardPaymentResponse) => void) {
  const pushToast = useUiStore((s) => s.pushToast);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CardPaymentInput) => post<CardPaymentResponse>('/payments/card', input),
    onSuccess: (data) => {
      pushToast(
        'success',
        `رسید شما ثبت شد (پرداخت #${toFa(data.paymentId)}) و در انتظار تأیید مدیر است.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      onSuccess?.(data);
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return;
      pushToast('error', errorMessage(e));
    },
  });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className="focus-ring shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-primary-700"
      onClick={async () => {
        const ok = await copyText(value);
        if (ok) {
          setCopied(true);
          pushToast('success', 'کپی شد.');
          window.setTimeout(() => setCopied(false), 1600);
        } else {
          pushToast('error', 'کپی ناموفق بود؛ مقدار را دستی کپی کنید.');
        }
      }}
    >
      {copied ? (
        <Check aria-hidden="true" className="size-4 text-green-600" />
      ) : (
        <Copy aria-hidden="true" className="size-4" />
      )}
    </button>
  );
}

/** 16-digit card number → grouped display (۴‌تایی). */
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

/** Card-to-card info: number + holder with copy buttons (read-only). */
export function CardInfoPanel({
  number,
  holder,
}: {
  number: string;
  holder: string | null | undefined;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
        <span className="min-w-0">
          <span className="block text-[11px] text-neutral-400">شماره کارت</span>
          <span dir="ltr" className="block truncate text-sm font-bold tracking-wider text-neutral-900">
            {toFa(formatCardNumber(number))}
          </span>
        </span>
        <CopyButton value={number.replace(/\D/g, '')} label="کپی شماره کارت" />
      </div>
      {holder ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
          <span className="min-w-0">
            <span className="block text-[11px] text-neutral-400">به نام</span>
            <span className="block truncate text-sm font-medium text-neutral-900">{holder}</span>
          </span>
          <CopyButton value={holder} label="کپی نام صاحب کارت" />
        </div>
      ) : null}
    </div>
  );
}

/** Shared reference input for the card-to-card flow. */
export function ReferenceInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  return (
    <Input
      label="شماره پیگیری واریز"
      required
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error ?? undefined}
      hint="شماره پیگیری/مرجع تراکنش را از رسید بانکی وارد کنید."
    />
  );
}

/**
 * Self-contained card-to-card dialog (SubscriptionPage): shows the card info,
 * takes the transfer reference and submits POST /payments/card.
 */
export function CardPaymentDialog({
  open,
  onClose,
  planId,
  amount,
  title,
  description,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  planId: number | string;
  amount?: number;
  title: string;
  description?: string;
  onSubmitted?: (data: CardPaymentResponse) => void;
}) {
  const methods = usePaymentMethods();
  const [reference, setReference] = useState('');
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const cardPayment = useCardPayment((data) => {
    setReference('');
    setReferenceError(null);
    onSubmitted?.(data);
  });

  const card = methods.data?.card;
  const cardEnabled = card?.enabled === true && typeof card?.number === 'string' && card.number.length > 0;

  function submit() {
    const err = validateReference(reference);
    setReferenceError(err);
    if (err !== null) return;
    cardPayment.mutate({ purpose: 'SUBSCRIPTION', planId, amount, reference: reference.trim() });
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="sm">
      {methods.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !cardEnabled ? (
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm text-neutral-500">
          پرداخت کارت به کارت در حال حاضر فعال نیست. بعداً تلاش کنید یا از درگاه آنلاین استفاده کنید.
        </p>
      ) : (
        <div className="space-y-4">
          {typeof amount === 'number' && amount > 0 ? (
            <div className="flex items-center justify-between rounded-xl border border-primary-200 bg-primary-50/60 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 font-medium text-primary-900">
                <WalletCards aria-hidden="true" className="size-4" />
                مبلغ قابل پرداخت
              </span>
              <span className="font-bold text-primary-900">{faMoney(amount)}</span>
            </div>
          ) : null}
          <CardInfoPanel number={card!.number as string} holder={card!.holder} />
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            مبلغ را دقیقاً به همین شماره کارت واریز کنید؛ سپس شماره پیگیری تراکنش را وارد نمایید. پس از تأیید مدیر، پلن شما فعال می‌شود.
          </p>
          <ReferenceInput value={reference} onChange={setReference} error={referenceError} />
          <div className="flex items-center gap-2 pt-1">
            <Button loading={cardPayment.isPending} onClick={submit}>
              ثبت رسید پرداخت
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={cardPayment.isPending}>
              انصراف
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Small inline toggle used by the wallet topup dialog (online vs card). */
export function MethodToggle({
  onlineEnabled,
  cardEnabled,
  value,
  onChange,
}: {
  onlineEnabled: boolean;
  cardEnabled: boolean;
  value: 'ONLINE' | 'CARD';
  onChange: (v: 'ONLINE' | 'CARD') => void;
}) {
  if (!onlineEnabled && !cardEnabled) return null;
  const options: Array<{ key: 'ONLINE' | 'CARD'; enabled: boolean }> = [
    { key: 'ONLINE', enabled: onlineEnabled },
    { key: 'CARD', enabled: cardEnabled },
  ];
  return (
    <div role="radiogroup" aria-label="روش پرداخت" className="grid grid-cols-2 gap-2">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          disabled={!option.enabled}
          onClick={() => onChange(option.key)}
          className={
            'focus-ring flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ' +
            (value === option.key
              ? 'border-primary-600 bg-primary-50 text-primary-800'
              : option.enabled
                ? 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300'
                : 'cursor-not-allowed border-neutral-100 bg-neutral-50 text-neutral-300')
          }
        >
          {option.key === 'ONLINE' ? (
            <Landmark aria-hidden="true" className="size-4" />
          ) : (
            <WalletCards aria-hidden="true" className="size-4" />
          )}
          {paymentMethodLabels[option.key]}
        </button>
      ))}
    </div>
  );
}
