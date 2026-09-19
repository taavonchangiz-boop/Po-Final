import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { patch } from '../../lib/api';
import { toEn, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { SwitchToggle } from './botUi';
import { aiProviderLabels, errorMessage, type BotRecord } from './botTypes';

/**
 * AI tab (task 4-d-1): enable + provider/model/systemPrompt/maxCreditsPerReply.
 * Backend AiConfigSchema (bots.service.ts): { enabled, provider default OPENAI,
 * model? ≤80, systemPrompt? ≤1000, maxCreditsPerReply? int 1..20 } — sent via
 * PATCH /bots/:id { aiConfig }.
 */

const PROVIDER_KEYS = Object.keys(aiProviderLabels);

export interface AiTabProps {
  botId: string;
  bot: BotRecord;
}

export function AiTab({ botId, bot }: AiTabProps) {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [enabled, setEnabled] = useState(bot.aiConfig?.enabled === true);
  const [provider, setProvider] = useState(bot.aiConfig?.provider || 'OPENAI');
  const [model, setModel] = useState(bot.aiConfig?.model ?? '');
  const [systemPrompt, setSystemPrompt] = useState(bot.aiConfig?.systemPrompt ?? '');
  const [maxCredits, setMaxCredits] = useState(
    bot.aiConfig?.maxCreditsPerReply !== undefined ? String(bot.aiConfig.maxCreditsPerReply) : '4',
  );

  useEffect(() => {
    setEnabled(bot.aiConfig?.enabled === true);
    setProvider(bot.aiConfig?.provider || 'OPENAI');
    setModel(bot.aiConfig?.model ?? '');
    setSystemPrompt(bot.aiConfig?.systemPrompt ?? '');
    setMaxCredits(
      bot.aiConfig?.maxCreditsPerReply !== undefined ? String(bot.aiConfig.maxCreditsPerReply) : '4',
    );
  }, [bot.aiConfig]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const credits = Number(toEn(maxCredits));
      return patch(`/bots/${botId}`, {
        aiConfig: {
          enabled,
          provider,
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
          ...(Number.isInteger(credits) && credits >= 1 && credits <= 20
            ? { maxCreditsPerReply: credits }
            : {}),
        },
      });
    },
    onSuccess: () => {
      pushToast('success', 'تنظیمات هوش مصنوعی ذخیره شد.');
      void queryClient.invalidateQueries({ queryKey: ['bot', botId] });
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles aria-hidden="true" className="size-4 text-primary-700" />
          پاسخ هوشمند
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-neutral-500">
          با فعال‌سازی پاسخ هوشمند، پیام‌های کاربران با مدل زبانی پاسخ داده می‌شود؛ مصرف اعتبار از سهمیه
          ماهانه پلن شما کسر می‌گردد.
        </p>

        <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-neutral-800">فعال‌سازی پاسخ هوشمند</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {enabled ? 'پاسخ‌گویی خودکار فعال است.' : 'پاسخ‌گویی خودکار خاموش است.'}
            </p>
          </div>
          <SwitchToggle
            checked={enabled}
            onChange={setEnabled}
            disabled={saveMutation.isPending}
            label="فعال‌سازی پاسخ هوشمند"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="سرویس هوش مصنوعی"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={!enabled || saveMutation.isPending}
          >
            {PROVIDER_KEYS.map((key) => (
              <option key={key} value={key}>
                {aiProviderLabels[key]}
              </option>
            ))}
            {!PROVIDER_KEYS.includes(provider) ? (
              <option value={provider}>{provider}</option>
            ) : null}
          </Select>
          <Input
            label="نام مدل (اختیاری)"
            dir="ltr"
            value={model}
            maxLength={80}
            placeholder="gpt-4o-mini"
            disabled={!enabled || saveMutation.isPending}
            onChange={(e) => setModel(e.target.value)}
            hint="خالی بمانید تا مدل پیش‌فرض سرویس استفاده شود."
          />
        </div>

        <Textarea
          label="پیام سیستمی (اختیاری)"
          rows={4}
          maxLength={1000}
          value={systemPrompt}
          disabled={!enabled || saveMutation.isPending}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="مثلاً: تو دستیار فروشگاهی هستی؛ مودب و کوتاه پاسخ بده…"
          hint="شخصیت و محدوده پاسخ‌های ربات را تعیین می‌کند."
        />

        <Input
          label="حداکثر اعتبار هر پاسخ"
          dir="ltr"
          inputMode="numeric"
          value={toFa(maxCredits || '')}
          disabled={!enabled || saveMutation.isPending}
          onChange={(e) => setMaxCredits(toEn(e.target.value).replace(/\D/g, '').slice(0, 2))}
          hint="عددی بین ۱ تا ۲۰؛ پاسخ‌های طولانی‌تر قطع می‌شوند."
        />

        <div className="flex items-center gap-2">
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
            <Save aria-hidden="true" className="size-4" />
            ذخیره تنظیمات
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
