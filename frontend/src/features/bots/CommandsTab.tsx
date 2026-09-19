import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { patch } from '../../lib/api';
import { toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { errorMessage, type BotCommand, type BotRecord } from './botTypes';

/**
 * Commands tab (task 4-d-1): rows editor for { command, description, response }.
 * Backend (bots.service.ts) normalizes the leading '/' and validates
 * command=/^\/?[A-Za-z0-9_]{1,32}$/, description≤100, response 1..500, ≤20 rows.
 */

const COMMAND_PATTERN = /^\/?[A-Za-z0-9_]{1,32}$/;
const MAX_COMMANDS = 20;

interface Row {
  command: string;
  description: string;
  response: string;
}

function normalizeRows(commands: BotCommand[] | null | undefined): Row[] {
  if (!Array.isArray(commands)) return [];
  return commands.map((c) => ({
    command: typeof c.command === 'string' ? c.command : '',
    description: typeof c.description === 'string' ? c.description : '',
    response: typeof c.response === 'string' ? c.response : '',
  }));
}

export interface CommandsTabProps {
  botId: string;
  bot: BotRecord;
}

export function CommandsTab({ botId, bot }: CommandsTabProps) {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [rows, setRows] = useState<Row[]>(() => normalizeRows(bot.commands));
  const [rowError, setRowError] = useState<string | null>(null);

  // Re-sync when the bot query refreshes (e.g. after other tabs save).
  useEffect(() => {
    setRows(normalizeRows(bot.commands));
  }, [bot.commands]);

  const saveMutation = useMutation({
    mutationFn: (commands: Array<{ command: string; description: string; response: string }>) =>
      patch(`/bots/${botId}`, { commands }),
    onSuccess: () => {
      pushToast('success', 'دستورها ذخیره شد.');
      void queryClient.invalidateQueries({ queryKey: ['bot', botId] });
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  function updateRow(index: number, patchRow: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patchRow } : r)));
    setRowError(null);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setRowError(null);
  }

  function addRow() {
    if (rows.length >= MAX_COMMANDS) {
      setRowError(`حداکثر ${toFa(MAX_COMMANDS)} دستور قابل تعریف است.`);
      return;
    }
    setRows((prev) => [...prev, { command: '', description: '', response: '' }]);
    setRowError(null);
  }

  function save() {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!COMMAND_PATTERN.test(r.command.trim())) {
        setRowError(
          `شناسه دستور ردیف ${toFa(i + 1)} معتبر نیست؛ فقط حروف انگلیسی، عدد و زیرخط (مثال: /start).`,
        );
        return;
      }
      if (r.description.trim().length > 100) {
        setRowError(`توضیح ردیف ${toFa(i + 1)} نباید از ۱۰۰ نویسه بیشتر باشد.`);
        return;
      }
      if (r.response.trim().length === 0 || r.response.trim().length > 500) {
        setRowError(`پاسخ ردیف ${toFa(i + 1)} باید بین ۱ تا ۵۰۰ نویسه باشد.`);
        return;
      }
    }
    saveMutation.mutate(
      rows.map((r) => ({
        command: r.command.trim(),
        description: r.description.trim(),
        response: r.response.trim(),
      })),
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>دستورهای ربات</CardTitle>
        <Button size="sm" variant="secondary" onClick={addRow} disabled={saveMutation.isPending}>
          <Plus aria-hidden="true" className="size-4" />
          افزودن دستور
        </Button>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-neutral-500">
          هرگاه کاربر یکی از دستورها را بفرستد، پاسخ تعریف‌شده به‌صورت خودکار ارسال می‌شود (حداکثر{' '}
          {toFa(MAX_COMMANDS)} دستور).
        </p>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">
            هنوز دستوری تعریف نشده است؛ با «افزودن دستور» شروع کنید.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row, i) => (
              <li key={i} className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    label="دستور"
                    dir="ltr"
                    value={row.command}
                    onChange={(e) => updateRow(i, { command: e.target.value })}
                    placeholder="/start"
                  />
                  <Input
                    label="توضیح"
                    value={row.description}
                    onChange={(e) => updateRow(i, { description: e.target.value })}
                    placeholder="شروع گفتگو"
                    maxLength={100}
                  />
                </div>
                <div className="mt-3">
                  <Textarea
                    label="پاسخ"
                    rows={2}
                    value={row.response}
                    onChange={(e) => updateRow(i, { response: e.target.value })}
                    placeholder="متن پاسخ خودکار…"
                    maxLength={500}
                  />
                </div>
                <div className="mt-2 flex justify-start">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    disabled={saveMutation.isPending}
                    onClick={() => removeRow(i)}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    حذف دستور
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {rowError ? (
          <p role="alert" className="text-sm text-red-600">
            {rowError}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button onClick={save} loading={saveMutation.isPending} disabled={rows.length === 0}>
            <Save aria-hidden="true" className="size-4" />
            ذخیره دستورها
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
