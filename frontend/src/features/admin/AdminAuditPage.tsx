import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { usePageTitle } from '../../app/usePageTitle';
import { get } from '../../lib/api';
import { faDateTime, labelOf, toFa } from '../../lib/format';
import { errorMessage, ErrorCard } from '../publishing/parts';
import { AUDIT_FILTER_OPTIONS, actorLabel, auditActionLabels, subjectLabel } from './adminParts';

/**
 * Admin audit logs. Verified against app/src/modules/admin/admin.routes.ts +
 * admin.service.ts + db/schema.ts:
 *  - GET /admin/audit-logs?page&limit&action → { items: [{ id, actorUserId,
 *    action, subjectType, subjectId, ip, userAgent, data, createdAt }], total,
 *    page, limit }. The `action` filter is an EXACT match.
 *  - actorUserId has no joined name (safe-columns policy) → shown as «کاربر #id».
 *  - Unknown action keys fall back to the raw technical string (honest fallback).
 */

interface AuditLogRecord {
  id: number | string;
  actorUserId?: number | null;
  action?: string;
  subjectType?: string | null;
  subjectId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  data?: Record<string, unknown> | null;
  createdAt?: string;
}

const PAGE_SIZE = 20;

export default function AdminAuditPage() {
  usePageTitle('رخدادهای مدیریتی');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);

  const logs = useQuery({
    queryKey: ['admin', 'audit', actionFilter, page],
    placeholderData: (prev) => prev,
    queryFn: () =>
      get<{ items?: AuditLogRecord[]; total?: number; page?: number; limit?: number }>(
        `/admin/audit-logs?page=${page}&limit=${PAGE_SIZE}${actionFilter ? `&action=${encodeURIComponent(actionFilter)}` : ''}`,
      ),
  });

  const items = logs.data?.items ?? [];
  const total = logs.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="رخدادهای مدیریتی"
        description="گزارش اقدامات حساس سیستم برای حسابرسی"
      />

      <div className="space-y-4">
        <div className="max-w-xs">
          <Select
            label="فیلتر اقدام"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
          >
            {AUDIT_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        {logs.isLoading ? (
          <Card>
            <CardBody className="space-y-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardBody>
          </Card>
        ) : logs.error ? (
          <ErrorCard message={errorMessage(logs.error)} onRetry={() => void logs.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="رخدادی ثبت نشده است"
            description="اقدامات مدیریتی و رخدادهای حساس به‌محض وقوع اینجا ثبت می‌شوند."
          />
        ) : (
          <>
            <Table caption="گزارش رخدادهای مدیریتی">
              <THead>
                <TR>
                  <TH>اقدام</TH>
                  <TH>فاعل</TH>
                  <TH>موضوع</TH>
                  <TH>IP</TH>
                  <TH>زمان</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((log) => (
                  <TR key={String(log.id)}>
                    <TD className="font-medium text-neutral-900">{labelOf(auditActionLabels, log.action)}</TD>
                    <TD className="text-neutral-600">{actorLabel(log.actorUserId)}</TD>
                    <TD className="text-xs text-neutral-500">{subjectLabel(log.subjectType, log.subjectId)}</TD>
                    <TD dir="ltr" className="text-xs text-neutral-500">
                      {log.ip || '—'}
                    </TD>
                    <TD className="text-xs text-neutral-500">{faDateTime(log.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="mt-2 text-xs text-neutral-400">
              {toFa(total)} رخداد ثبت‌شده — فیلتر «اقدام» مطابق تطبیق دقیق سرور اعمال می‌شود.
            </p>
            <Pagination className="mt-3" page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </div>
    </>
  );
}
