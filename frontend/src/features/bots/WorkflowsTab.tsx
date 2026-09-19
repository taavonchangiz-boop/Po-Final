import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  History,
  Pencil,
  Plus,
  Trash2,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { Dialog } from '../../components/ui/Dialog';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { del, get, post, patch } from '../../lib/api';
import { faDateTime, labelOf, toEn, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { ErrorCard } from './botUi';
import {
  WORKFLOW_LIMITS,
  errorMessage,
  runStatusLabels,
  stepLabels,
  triggerLabels,
  type WorkflowRecord,
  type WorkflowRunRecord,
  type WorkflowStepRecord,
} from './botTypes';

/**
 * Workflows tab (task 4-d-1): trigger + step builder with runs history.
 * Definition validated client-side against the backend zod (workflows.service.ts):
 *  - trigger { type: COMMAND|MESSAGE_KEYWORD|ANY_MESSAGE|NEW_MEMBER, value? } —
 *    value required for COMMAND/MESSAGE_KEYWORD, COMMAND matches /^\/?[A-Za-z0-9_]{1,32}$/.
 *  - steps 1..12: SEND_MESSAGE{text 1..3500} | SEND_BUTTONS{text, buttons 1..8
 *    {text 1..64, url?}} | AI_REPLY{system?} | WAIT{seconds 1..60} |
 *    CONDITION{field:'text', op contains|equals, value 1..200} — ≤3 AI, ≤6 outbound,
 *    ≤3 CONDITION steps.
 * PATCH /workflows/:id accepts { name?, definition?, isActive? }.
 */

type StepDraft =
  | { key: number; type: 'SEND_MESSAGE'; text: string }
  | { key: number; type: 'SEND_BUTTONS'; text: string; buttons: Array<{ text: string; url: string }> }
  | { key: number; type: 'AI_REPLY'; system: string }
  | { key: number; type: 'WAIT'; seconds: string }
  | { key: number; type: 'CONDITION'; op: 'contains' | 'equals'; value: string };

type TriggerType = keyof typeof triggerLabels;

const STEP_TYPE_KEYS = ['SEND_MESSAGE', 'SEND_BUTTONS', 'AI_REPLY', 'WAIT', 'CONDITION'] as const;
type StepType = (typeof STEP_TYPE_KEYS)[number];

const TRIGGER_KEYS = Object.keys(triggerLabels) as TriggerType[];

const COMMAND_PATTERN = /^\/?[A-Za-z0-9_]{1,32}$/;

let draftKeySeq = 1;
function nextKey(): number {
  return draftKeySeq++;
}

function str(config: Record<string, unknown> | undefined, field: string): string {
  const v = config?.[field];
  return typeof v === 'string' ? v : '';
}

function deserializeSteps(steps: WorkflowStepRecord[] | null | undefined): StepDraft[] {
  if (!Array.isArray(steps)) return [];
  const out: StepDraft[] = [];
  for (const step of steps) {
    const type = step?.type as StepType | undefined;
    const config = step?.config;
    if (type === 'SEND_MESSAGE') {
      out.push({ key: nextKey(), type, text: str(config, 'text') });
    } else if (type === 'SEND_BUTTONS') {
      const rawButtons = Array.isArray(config?.buttons) ? config?.buttons : [];
      out.push({
        key: nextKey(),
        type,
        text: str(config, 'text'),
        buttons: rawButtons
          .map((b) => ({
            text: typeof (b as Record<string, unknown>)?.text === 'string' ? String((b as Record<string, unknown>).text) : '',
            url: typeof (b as Record<string, unknown>)?.url === 'string' ? String((b as Record<string, unknown>).url) : '',
          }))
          .slice(0, WORKFLOW_LIMITS.maxButtons),
      });
    } else if (type === 'AI_REPLY') {
      out.push({ key: nextKey(), type, system: str(config, 'system') });
    } else if (type === 'WAIT') {
      const seconds = config?.seconds;
      out.push({
        key: nextKey(),
        type,
        seconds: typeof seconds === 'number' && Number.isFinite(seconds) ? String(seconds) : '5',
      });
    } else if (type === 'CONDITION') {
      const op = str(config, 'op') === 'equals' ? 'equals' : 'contains';
      out.push({ key: nextKey(), type, op, value: str(config, 'value') });
    }
  }
  return out;
}

function serializeSteps(steps: StepDraft[]): Array<{ type: string; config: Record<string, unknown> }> {
  return steps.map((s) => {
    switch (s.type) {
      case 'SEND_MESSAGE':
        return { type: s.type, config: { text: s.text.trim() } };
      case 'SEND_BUTTONS': {
        const buttons = s.buttons
          .filter((b) => b.text.trim().length > 0)
          .map((b) => ({
            text: b.text.trim(),
            ...(b.url.trim() ? { url: b.url.trim() } : {}),
          }));
        return { type: s.type, config: { text: s.text.trim(), buttons } };
      }
      case 'AI_REPLY':
        return {
          type: s.type,
          config: s.system.trim() ? { system: s.system.trim() } : {},
        };
      case 'WAIT':
        return { type: s.type, config: { seconds: Number(toEn(s.seconds)) } };
      case 'CONDITION':
        return { type: s.type, config: { field: 'text', op: s.op, value: s.value.trim() } };
    }
  });
}

function moveStep(steps: StepDraft[], index: number, delta: -1 | 1): StepDraft[] {
  const target = index + delta;
  if (target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export interface WorkflowsTabProps {
  botId: string;
}

export function WorkflowsTab({ botId }: WorkflowsTabProps) {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  // ------------------------------- list state -------------------------------
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | string | null>(null);
  const [deletingWorkflow, setDeletingWorkflow] = useState<WorkflowRecord | null>(null);
  const [runsWorkflow, setRunsWorkflow] = useState<WorkflowRecord | null>(null);

  const list = useQuery({
    queryKey: ['workflows', 'bot', botId],
    queryFn: () => get<{ items: WorkflowRecord[] }>(`/workflows?botId=${botId}&page=1&limit=100`),
  });

  const workflows: WorkflowRecord[] = useMemo(
    () => (Array.isArray(list.data?.items) ? list.data.items : []),
    [list.data],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: number | string) => del(`/workflows/${id}`),
    onSuccess: () => {
      pushToast('success', 'گردش‌کار حذف شد.');
      setDeletingWorkflow(null);
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (e: unknown) => {
      pushToast('error', errorMessage(e));
      setDeletingWorkflow(null);
    },
  });

  // ------------------------------ builder state -----------------------------
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('COMMAND');
  const [triggerValue, setTriggerValue] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [addStepType, setAddStepType] = useState<StepType>('SEND_MESSAGE');
  const [builderError, setBuilderError] = useState<string | null>(null);

  function openBuilder(workflow: WorkflowRecord | null) {
    if (workflow) {
      setName(workflow.name ?? '');
      const def = workflow.definition;
      const t = (def?.trigger?.type ?? 'COMMAND') as TriggerType;
      setTriggerType(TRIGGER_KEYS.includes(t) ? t : 'COMMAND');
      setTriggerValue(typeof def?.trigger?.value === 'string' ? def.trigger.value : '');
      setSteps(deserializeSteps(def?.steps));
      setEditingId(workflow.id);
    } else {
      setName('');
      setTriggerType('COMMAND');
      setTriggerValue('');
      setSteps([]);
      setEditingId(null);
    }
    setAddStepType('SEND_MESSAGE');
    setBuilderError(null);
    setBuilderOpen(true);
  }

  function addStep() {
    if (steps.length >= WORKFLOW_LIMITS.maxSteps) {
      setBuilderError(`حداکثر ${toFa(WORKFLOW_LIMITS.maxSteps)} گام مجاز است.`);
      return;
    }
    setBuilderError(null);
    switch (addStepType) {
      case 'SEND_MESSAGE':
        setSteps((p) => [...p, { key: nextKey(), type: 'SEND_MESSAGE', text: '' }]);
        break;
      case 'SEND_BUTTONS':
        setSteps((p) => [
          ...p,
          { key: nextKey(), type: 'SEND_BUTTONS', text: '', buttons: [{ text: '', url: '' }] },
        ]);
        break;
      case 'AI_REPLY':
        setSteps((p) => [...p, { key: nextKey(), type: 'AI_REPLY', system: '' }]);
        break;
      case 'WAIT':
        setSteps((p) => [...p, { key: nextKey(), type: 'WAIT', seconds: '5' }]);
        break;
      case 'CONDITION':
        setSteps((p) => [...p, { key: nextKey(), type: 'CONDITION', op: 'contains', value: '' }]);
        break;
    }
  }

  function submitBuilder() {
    if (!name.trim()) {
      setBuilderError('نام گردش‌کار را وارد کنید.');
      return;
    }
    const needsValue = triggerType === 'COMMAND' || triggerType === 'MESSAGE_KEYWORD';
    if (needsValue && !triggerValue.trim()) {
      setBuilderError(
        triggerType === 'COMMAND' ? 'مقدار دستور (مثال: start) الزامی است.' : 'کلیدواژه پیام را وارد کنید.',
      );
      return;
    }
    if (triggerType === 'COMMAND' && !COMMAND_PATTERN.test(triggerValue.trim())) {
      setBuilderError('دستور فقط حروف انگلیسی، عدد و زیرخط می‌پذیرد (حداکثر ۳۲ نویسه).');
      return;
    }
    if (steps.length === 0) {
      setBuilderError('حداقل یک گام برای گردش‌کار لازم است.');
      return;
    }

    let ai = 0;
    let outbound = 0;
    let condition = 0;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.type === 'SEND_MESSAGE') {
        if (!s.text.trim()) {
          setBuilderError(`متن گام ${toFa(i + 1)} (ارسال پیام) الزامی است.`);
          return;
        }
        outbound++;
      } else if (s.type === 'SEND_BUTTONS') {
        if (!s.text.trim()) {
          setBuilderError(`متن گام ${toFa(i + 1)} (ارسال دکمه) الزامی است.`);
          return;
        }
        const validButtons = s.buttons.filter((b) => b.text.trim());
        if (validButtons.length === 0) {
          setBuilderError(`گام ${toFa(i + 1)} حداقل یک دکمه با متن نیاز دارد.`);
          return;
        }
        for (const b of validButtons) {
          if (b.url.trim()) {
            try {
              const u = new URL(b.url.trim());
              if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
            } catch {
              setBuilderError(`نشانی دکمه در گام ${toFa(i + 1)} معتبر نیست (با http یا https شروع شود).`);
              return;
            }
          }
        }
        outbound++;
      } else if (s.type === 'WAIT') {
        const seconds = Number(toEn(s.seconds));
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > WORKFLOW_LIMITS.maxWaitSeconds) {
          setBuilderError(`توقف گام ${toFa(i + 1)} باید عددی بین ۱ تا ${toFa(WORKFLOW_LIMITS.maxWaitSeconds)} ثانیه باشد.`);
          return;
        }
      } else if (s.type === 'CONDITION') {
        if (!s.value.trim()) {
          setBuilderError(`مقدار شرط در گام ${toFa(i + 1)} الزامی است.`);
          return;
        }
        condition++;
      } else if (s.type === 'AI_REPLY') {
        ai++;
      }
    }
    if (ai > WORKFLOW_LIMITS.maxAiSteps) {
      setBuilderError(`حداکثر ${toFa(WORKFLOW_LIMITS.maxAiSteps)} گام هوش مصنوعی مجاز است.`);
      return;
    }
    if (outbound > WORKFLOW_LIMITS.maxOutboundSteps) {
      setBuilderError(`حداکثر ${toFa(WORKFLOW_LIMITS.maxOutboundSteps)} گام ارسال مجاز است.`);
      return;
    }
    if (condition > WORKFLOW_LIMITS.maxConditionSteps) {
      setBuilderError(`حداکثر ${toFa(WORKFLOW_LIMITS.maxConditionSteps)} گام شرط مجاز است.`);
      return;
    }

    const definition = {
      trigger: {
        type: triggerType,
        ...(triggerValue.trim() ? { value: triggerValue.trim().replace(/^\//, '') } : {}),
      },
      steps: serializeSteps(steps),
    };
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, name: name.trim(), definition });
    } else {
      createMutation.mutate({ name: name.trim(), definition });
    }
  }

  const createMutation = useMutation({
    mutationFn: (input: { name: string; definition: unknown }) =>
      post(`/workflows`, { botId: Number(botId), ...input }),
    onSuccess: () => {
      pushToast('success', 'گردش‌کار ساخته شد.');
      setBuilderOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: number | string; name: string; definition: unknown }) =>
      patch(`/workflows/${input.id}`, { name: input.name, definition: input.definition }),
    onSuccess: () => {
      pushToast('success', 'گردش‌کار بروزرسانی شد.');
      setBuilderOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const builderPending = createMutation.isPending || updateMutation.isPending;

  // -------------------------------- runs state ------------------------------
  const runsQuery = useQuery({
    queryKey: ['workflow-runs', String(runsWorkflow?.id ?? '')],
    queryFn: () =>
      get<{ items: WorkflowRunRecord[]; total: number; page: number; limit: number }>(
        `/workflows/${runsWorkflow?.id}/runs?page=1&limit=20`,
      ),
    enabled: runsWorkflow !== null,
  });

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>گردش‌کارهای این ربات</CardTitle>
        <Button size="sm" onClick={() => openBuilder(null)}>
          <Plus aria-hidden="true" className="size-4" />
          گردش‌کار جدید
        </Button>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-neutral-500">
          گردش‌کار پیام‌های دریافتی ربات را به‌صورت خودکار پردازش می‌کند؛ محرک و گام‌ها را تعریف کنید.
        </p>

        {list.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : list.error ? (
          <ErrorCard message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : workflows.length === 0 ? (
          <EmptyState
            icon={WorkflowIcon}
            title="گردش‌کاری برای این ربات تعریف نشده"
            description="با تعریف محرک (دستور، کلیدواژه یا هر پیام) و گام‌های خودکار، پاسخ‌گویی ربات را خودکار کنید."
            action={
              <Button size="sm" onClick={() => openBuilder(null)}>
                <Plus aria-hidden="true" className="size-4" />
                گردش‌کار جدید
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {workflows.map((wf) => {
              const trigger = wf.definition?.trigger;
              const stepCount = Array.isArray(wf.definition?.steps) ? wf.definition?.steps?.length ?? 0 : 0;
              return (
                <li key={String(wf.id)} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900">
                      <span className="truncate">{wf.name || '—'}</span>
                      {wf.isActive ? (
                        <Badge tone="success">فعال</Badge>
                      ) : (
                        <Badge tone="neutral">غیرفعال</Badge>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      محرک: {labelOf(triggerLabels, trigger?.type)}
                      {trigger?.value ? ` «${trigger.value}»` : ''} — {toFa(stepCount)} گام —{' '}
                      {toFa(wf.runCount ?? 0)} اجرا
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setRunsWorkflow(wf)}>
                      <History aria-hidden="true" className="size-4" />
                      اجراها
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openBuilder(wf)}>
                      <Pencil aria-hidden="true" className="size-4" />
                      ویرایش
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600"
                      disabled={deleteMutation.isPending}
                      onClick={() => setDeletingWorkflow(wf)}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      حذف
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>

      {/* ------------------------------ builder dialog ----------------------------- */}
      <Dialog
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        title={editingId !== null ? 'ویرایش گردش‌کار' : 'گردش‌کار جدید'}
        description="محرک و گام‌های خودکار را تعریف کنید."
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="نام گردش‌کار"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً خوش‌آمدگویی خودکار"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="محرک"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as TriggerType)}
            >
              {TRIGGER_KEYS.map((t) => (
                <option key={t} value={t}>
                  {triggerLabels[t]}
                </option>
              ))}
            </Select>
            {triggerType === 'COMMAND' || triggerType === 'MESSAGE_KEYWORD' ? (
              <Input
                label={triggerType === 'COMMAND' ? 'دستور' : 'کلیدواژه'}
                dir={triggerType === 'COMMAND' ? 'ltr' : undefined}
                value={triggerValue}
                onChange={(e) => setTriggerValue(e.target.value)}
                placeholder={triggerType === 'COMMAND' ? 'start' : 'مثلاً قیمت'}
                hint={triggerType === 'COMMAND' ? 'بدون «/»؛ خودکار اضافه می‌شود.' : undefined}
              />
            ) : null}
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-neutral-700">گام‌ها ({toFa(steps.length)})</p>
            {steps.length === 0 ? (
              <p className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-5 text-center text-sm text-neutral-500">
                هنوز گامی اضافه نشده است.
              </p>
            ) : (
              <ol className="space-y-3">
                {steps.map((s, i) => (
                  <li key={s.key} className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-neutral-800">
                        {toFa(i + 1)}. {stepLabels[s.type]}
                      </p>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="انتقال به بالا"
                          disabled={i === 0 || builderPending}
                          onClick={() => setSteps((p) => moveStep(p, i, -1))}
                        >
                          <ArrowUp aria-hidden="true" className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="انتقال به پایین"
                          disabled={i === steps.length - 1 || builderPending}
                          onClick={() => setSteps((p) => moveStep(p, i, 1))}
                        >
                          <ArrowDown aria-hidden="true" className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600"
                          aria-label="حذف گام"
                          disabled={builderPending}
                          onClick={() => setSteps((p) => p.filter((x) => x.key !== s.key))}
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </Button>
                      </div>
                    </div>

                    {s.type === 'SEND_MESSAGE' ? (
                      <Textarea
                        label="متن پیام"
                        rows={2}
                        maxLength={3500}
                        value={s.text}
                        onChange={(e) =>
                          setSteps((p) =>
                            p.map((x) => (x.key === s.key && x.type === 'SEND_MESSAGE' ? { ...x, text: e.target.value } : x)),
                          )
                        }
                      />
                    ) : null}

                    {s.type === 'SEND_BUTTONS' ? (
                      <div className="space-y-3">
                        <Textarea
                          label="متن پیام"
                          rows={2}
                          maxLength={3500}
                          value={s.text}
                          onChange={(e) =>
                            setSteps((p) =>
                              p.map((x) => (x.key === s.key && x.type === 'SEND_BUTTONS' ? { ...x, text: e.target.value } : x)),
                            )
                          }
                        />
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-neutral-500">
                            دکمه‌ها (حداکثر {toFa(WORKFLOW_LIMITS.maxButtons)})
                          </p>
                          {s.buttons.map((btn, bi) => (
                            <div key={bi} className="flex flex-wrap items-end gap-2">
                              <div className="min-w-36 flex-1">
                                <Input
                                  label="متن دکمه"
                                  value={btn.text}
                                  maxLength={64}
                                  onChange={(e) =>
                                    setSteps((p) =>
                                      p.map((x) =>
                                        x.key === s.key && x.type === 'SEND_BUTTONS'
                                          ? { ...x, buttons: x.buttons.map((b, j) => (j === bi ? { ...b, text: e.target.value } : b)) }
                                          : x,
                                      ),
                                    )
                                  }
                                />
                              </div>
                              <div className="min-w-48 flex-[2]">
                                <Input
                                  label="نشانی (اختیاری)"
                                  dir="ltr"
                                  value={btn.url}
                                  placeholder="https://…"
                                  onChange={(e) =>
                                    setSteps((p) =>
                                      p.map((x) =>
                                        x.key === s.key && x.type === 'SEND_BUTTONS'
                                          ? { ...x, buttons: x.buttons.map((b, j) => (j === bi ? { ...b, url: e.target.value } : b)) }
                                          : x,
                                      ),
                                    )
                                  }
                                />
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="mb-0.5 text-red-600"
                                aria-label="حذف دکمه"
                                disabled={builderPending}
                                onClick={() =>
                                  setSteps((p) =>
                                    p.map((x) =>
                                      x.key === s.key && x.type === 'SEND_BUTTONS'
                                        ? { ...x, buttons: x.buttons.filter((_, j) => j !== bi) }
                                        : x,
                                    ),
                                  )
                                }
                              >
                                <Trash2 aria-hidden="true" className="size-4" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={
                              builderPending || s.buttons.length >= WORKFLOW_LIMITS.maxButtons
                            }
                            onClick={() =>
                              setSteps((p) =>
                                p.map((x) =>
                                  x.key === s.key && x.type === 'SEND_BUTTONS'
                                    ? { ...x, buttons: [...x.buttons, { text: '', url: '' }] }
                                    : x,
                                ),
                              )
                            }
                          >
                            <Plus aria-hidden="true" className="size-4" />
                            افزودن دکمه
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {s.type === 'AI_REPLY' ? (
                      <Textarea
                        label="پیام سیستمی هوش مصنوعی (اختیاری)"
                        rows={2}
                        maxLength={500}
                        value={s.system}
                        onChange={(e) =>
                          setSteps((p) =>
                            p.map((x) => (x.key === s.key && x.type === 'AI_REPLY' ? { ...x, system: e.target.value } : x)),
                          )
                        }
                        hint="شخصیت و محدوده پاسخ ربات را مشخص می‌کند."
                      />
                    ) : null}

                    {s.type === 'WAIT' ? (
                      <Input
                        label="مدت توقف (ثانیه)"
                        dir="ltr"
                        inputMode="numeric"
                        value={s.seconds}
                        onChange={(e) =>
                          setSteps((p) =>
                            p.map((x) => (x.key === s.key && x.type === 'WAIT' ? { ...x, seconds: e.target.value } : x)),
                          )
                        }
                        hint={`بین ۱ تا ${toFa(WORKFLOW_LIMITS.maxWaitSeconds)} ثانیه.`}
                      />
                    ) : null}

                    {s.type === 'CONDITION' ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Select
                          label="مقایسه"
                          value={s.op}
                          onChange={(e) =>
                            setSteps((p) =>
                              p.map((x) =>
                                x.key === s.key && x.type === 'CONDITION'
                                  ? { ...x, op: e.target.value as 'contains' | 'equals' }
                                  : x,
                              ),
                            )
                          }
                        >
                          <option value="contains">شامل باشد</option>
                          <option value="equals">برابر باشد</option>
                        </Select>
                        <Input
                          label="مقدار"
                          value={s.value}
                          onChange={(e) =>
                            setSteps((p) =>
                              p.map((x) => (x.key === s.key && x.type === 'CONDITION' ? { ...x, value: e.target.value } : x)),
                            )
                          }
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-white p-3">
              <div className="w-52">
                <Select
                  label="افزودن گام"
                  value={addStepType}
                  onChange={(e) => setAddStepType(e.target.value as StepType)}
                >
                  {STEP_TYPE_KEYS.map((t) => (
                    <option key={t} value={t}>
                      {stepLabels[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="secondary" onClick={addStep} disabled={builderPending}>
                <Plus aria-hidden="true" className="size-4" />
                افزودن گام
              </Button>
            </div>
          </div>

          {builderError ? (
            <p role="alert" className="text-sm text-red-600">
              {builderError}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button onClick={submitBuilder} loading={builderPending}>
              {editingId !== null ? 'ذخیره تغییرات' : 'ساخت گردش‌کار'}
            </Button>
            <Button variant="ghost" onClick={() => setBuilderOpen(false)} disabled={builderPending}>
              انصراف
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -------------------------------- runs dialog ------------------------------- */}
      <Dialog
        open={runsWorkflow !== null}
        onClose={() => setRunsWorkflow(null)}
        title="تاریخچه اجرا"
        description={runsWorkflow?.name || undefined}
        size="lg"
      >
        {runsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : runsQuery.error ? (
          <ErrorCard message={errorMessage(runsQuery.error)} onRetry={() => void runsQuery.refetch()} />
        ) : (runsQuery.data?.items ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">
            هنوز اجرایی ثبت نشده است؛ اجرا پس از فعال بودن گردش‌کار و رسیدن پیام ثبت می‌شود.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {(runsQuery.data?.items ?? []).map((run) => (
              <li key={String(run.id)} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    tone={
                      run.status === 'COMPLETED'
                        ? 'success'
                        : run.status === 'FAILED'
                          ? 'danger'
                          : run.status === 'RUNNING'
                            ? 'info'
                            : 'neutral'
                    }
                  >
                    {labelOf(runStatusLabels, run.status)}
                  </Badge>
                  <span className="text-xs text-neutral-500">
                    {faDateTime(run.startedAt) || '—'}
                    {run.finishedAt ? ` تا ${faDateTime(run.finishedAt)}` : ''}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  گام‌های اجراشده: {toFa(run.stepsExecuted ?? 0)} — درخواست‌های ارسالی:{' '}
                  {toFa(run.outboundCalls ?? 0)}
                </p>
                {run.error ? <p className="mt-1 text-xs text-red-600">{run.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      {/* ------------------------------ delete confirm ----------------------------- */}
      <ConfirmDialog
        open={deletingWorkflow !== null}
        onClose={() => setDeletingWorkflow(null)}
        onConfirm={() => {
          if (deletingWorkflow) deleteMutation.mutate(deletingWorkflow.id);
        }}
        loading={deleteMutation.isPending}
        title="حذف گردش‌کار"
        description={`آیا از حذف «${deletingWorkflow?.name || 'این گردش‌کار'}» مطمئن هستید؟ این عمل بازگشت‌پذیر نیست.`}
        confirmLabel="بله، حذف کن"
      />
    </Card>
  );
}
