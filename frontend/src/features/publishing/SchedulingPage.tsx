import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarSync, Pause, Play, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Badge } from '../../components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { Select } from '../../components/ui/Select';
import { usePageTitle } from '../../app/usePageTitle';
import { patch, del } from '../../lib/api';
import { faDateTime, labelOf, toFa } from '../../lib/format';
import { useUiStore } from '../../store/ui';
import { usePaged } from '../hooks/usePaged';
import { JalaliPicker } from './JalaliPicker';
import {
  ErrorCard,
  errorMessage,
  recurrenceLabels,
  scheduleStatusLabels,
  type ScheduleRecord,
} from './parts';

/**
 * Scheduling (task 4-d-1) — Jalali schedule management.
 * Backend shapes verified against app/src/modules/publishing/publishing.routes.ts:
 *  - GET /schedules → rows { id, postId, postTitle, runAt, recurrence, status, … }.
 *  - PATCH /schedules/:id accepts { runAt? ISO, recurrence?, status?: ACTIVE|PAUSED }.
 *  - DELETE /schedules/:id cancels the schedule.
 */

interface UpdateScheduleResponse {
  id?: number;
  status?: string;
  runAt?: string;
  nextRunAt?: string | null;
}

export default function SchedulingPage() {
  usePageTitle('زمان‌بندی');
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const [editId, setEditId] = useState<number | string | null>(null);
  const [editIso, setEditIso] = useState<string | null>(null);
  const [editRecurrence, setEditRecurrence] = useState('ONCE');
  const [deleteId, setDeleteId] = useState<number | string | null>(null);

  const schedules = usePaged<ScheduleRecord>({
    queryKey: ['schedules'],
    buildPath: (page, limit) => `/schedules?page=${page}&limit=${limit}`,
  });

  const invalidateSchedules = () => {
    void queryClient.invalidateQueries({ queryKey: ['schedules'] });
    void queryClient.invalidateQueries({ queryKey: ['posts'] });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: number | string; status: 'ACTIVE' | 'PAUSED' }) =>
      patch<UpdateScheduleResponse>(`/schedules/${id}`, { status }),
    onSuccess: (_data, vars) => {
      pushToast('success', vars.status === 'ACTIVE' ? 'زمان‌بندی ادامه یافت.' : 'زمان‌بندی متوقف شد.');
      void queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, runAt, recurrence }: { id: number | string; runAt: string; recurrence: string }) =>
      patch<UpdateScheduleResponse>(`/schedules/${id}`, { runAt, recurrence }),
    onSuccess: () => {
      pushToast('success', 'زمان اجرا بروزرسانی شد.');
      setEditId(null);
      invalidateSchedules();
    },
    onError: (e: unknown) => pushToast('error', errorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number | string) => del(`/schedules/${id}`),
    onSuccess: () => {
      pushToast('success', 'زمان‌بندی لغو شد.');
      setDeleteId(null);
      invalidateSchedules();
    },
    onError: (e: unknown) => {
      pushToast('error', errorMessage(e));
      setDeleteId(null);
    },
  });

  const editTarget = schedules.items.find((s) => String(s.id) === String(editId)) ?? null;
  const deleteTarget = schedules.items.find((s) => String(s.id) === String(deleteId)) ?? null;

  function openEdit(schedule: ScheduleRecord) {
    setEditRecurrence(schedule.recurrence || 'ONCE');
    setEditIso(schedule.runAt ?? null); // JalaliPicker re-derives from ISO
    setEditId(schedule.id);
  }

  return (
    <>
      <PageHeader
        title="زمان‌بندی"
        description="انتشار خودکار با تقویم جلالی و ساعت ایران"
      />

      <div className="space-y-4">
        {schedules.isLoading ? (
          <div className="space-y-3 rounded-card border border-neutral-200 bg-white p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : schedules.error ? (
          <ErrorCard message={errorMessage(schedules.error)} onRetry={() => void schedules.refetch()} />
        ) : schedules.items.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="زمان‌بندی فعالی ندارید"
            description="برای انتشار خودکار، پست‌های خود را با تقویم جلالی زمان‌بندی کنید؛ می‌توانید هر زمان آن‌ها را متوقف یا لغو کنید."
          />
        ) : (
          <>
            <Table caption="فهرست زمان‌بندی‌ها">
              <THead>
                <TR>
                  <TH>پست</TH>
                  <TH>زمان اجرا</TH>
                  <TH>تکرار</TH>
                  <TH>وضعیت</TH>
                  <TH>عملیات</TH>
                </TR>
              </THead>
              <TBody>
                {schedules.items.map((s) => {
                  const canToggle = s.status === 'ACTIVE' || s.status === 'PAUSED';
                  return (
                    <TR key={String(s.id)}>
                      <TD className="max-w-64 font-medium text-neutral-900">
                        <span className="block truncate">{s.postTitle || `پست ${toFa(String(s.postId ?? ''))}`}</span>
                      </TD>
                      <TD className="text-xs text-neutral-600">{faDateTime(s.runAt) || '—'}</TD>
                      <TD className="text-xs text-neutral-600">
                        {labelOf(recurrenceLabels, s.recurrence)}
                      </TD>
                      <TD>
                        <Badge state={s.status} labels={scheduleStatusLabels} />
                      </TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-2">
                          {canToggle ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={
                                toggleMutation.isPending &&
                                toggleMutation.variables?.id === s.id
                              }
                              disabled={toggleMutation.isPending}
                              onClick={() =>
                                toggleMutation.mutate({
                                  id: s.id,
                                  status: s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                                })
                              }
                            >
                              {s.status === 'ACTIVE' ? (
                                <>
                                  <Pause aria-hidden="true" className="size-4" />
                                  توقف
                                </>
                              ) : (
                                <>
                                  <Play aria-hidden="true" className="size-4" />
                                  ادامه
                                </>
                              )}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={editMutation.isPending}
                            onClick={() => openEdit(s)}
                          >
                            <CalendarSync aria-hidden="true" className="size-4" />
                            ویرایش زمان
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            disabled={deleteMutation.isPending}
                            onClick={() => setDeleteId(s.id)}
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                            حذف
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination
              page={schedules.page}
              totalPages={schedules.totalPages}
              onChange={schedules.setPage}
            />
          </>
        )}
      </div>

      {/* ------------------------------- edit dialog ------------------------------ */}
      <Dialog
        open={editId !== null}
        onClose={() => setEditId(null)}
        title="ویرایش زمان اجرا"
        description={editTarget?.postTitle || undefined}
      >
        <div className="space-y-4">
          <JalaliPicker value={editIso} onChange={setEditIso} />
          <Select
            label="تکرار"
            value={editRecurrence}
            onChange={(e) => setEditRecurrence(e.target.value)}
          >
            {Object.entries(recurrenceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                if (editId !== null && editIso) {
                  editMutation.mutate({ id: editId, runAt: editIso, recurrence: editRecurrence });
                }
              }}
              loading={editMutation.isPending}
              disabled={!editIso}
            >
              ذخیره زمان جدید
            </Button>
            <Button variant="ghost" onClick={() => setEditId(null)} disabled={editMutation.isPending}>
              انصراف
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ----------------------------- delete confirm ----------------------------- */}
      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId !== null) deleteMutation.mutate(deleteId);
        }}
        loading={deleteMutation.isPending}
        title="لغو زمان‌بندی"
        description={`آیا از لغو زمان‌بندی «${deleteTarget?.postTitle || 'این زمان‌بندی'}» مطمئن هستید؟ پست حذف نمی‌شود؛ فقط اجرای خودکار آن متوقف می‌شود.`}
        confirmLabel="بله، لغو کن"
      />
    </>
  );
}
