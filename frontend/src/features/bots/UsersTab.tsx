import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Users } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Pagination } from '../../components/ui/Pagination';
import { get } from '../../lib/api';
import { faDate, faDateTime, toFa } from '../../lib/format';
import { ErrorCard } from './botUi';
import { errorMessage, type BotUserRecord } from './botTypes';

/**
 * Users tab (task 4-d-1): GET /bots/:id/users (privacy-minimal).
 * Rows (bots.routes.ts): { id, displayName, externalUserId, firstSeenAt, lastSeenAt }.
 */

interface UsersPage {
  items: BotUserRecord[];
  total: number;
  page: number;
  limit: number;
}

const PRIVACY_NOTE = 'فقط داده‌های حداقلی نگهداری می‌شود.';

export interface UsersTabProps {
  botId: string;
}

export function UsersTab({ botId }: UsersTabProps) {
  const [page, setPage] = useState(1);

  const users = useQuery({
    queryKey: ['bot-users', botId, page],
    queryFn: () => get<UsersPage>(`/bots/${botId}/users?page=${page}&limit=20`),
  });

  const items = Array.isArray(users.data?.items) ? users.data.items : [];
  const total = users.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>کاربران ربات</CardTitle>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800">
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          {PRIVACY_NOTE}
        </span>
      </CardHeader>
      <CardBody className="space-y-4">
        {users.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : users.error ? (
          <ErrorCard message={errorMessage(users.error)} onRetry={() => void users.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Users}
            title="کاربری ثبت نشده"
            description="پس از تعامل کاربران با ربات، فهرست آن‌ها با کمترین داده ممکن در همین بخش نمایش داده می‌شود."
          />
        ) : (
          <>
            <Table caption="کاربران ربات">
              <THead>
                <TR>
                  <TH>نام نمایشی</TH>
                  <TH>شناسه کاربر</TH>
                  <TH>اولین مشاهده</TH>
                  <TH>آخرین مشاهده</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((u) => (
                  <TR key={String(u.id)}>
                    <TD className="font-medium text-neutral-900">{u.displayName || '—'}</TD>
                    <TD dir="ltr" className="text-xs text-neutral-500">
                      {u.externalUserId || '—'}
                    </TD>
                    <TD className="text-xs text-neutral-500">{faDate(u.firstSeenAt) || '—'}</TD>
                    <TD className="text-xs text-neutral-500">
                      {faDateTime(u.lastSeenAt) || '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="text-center text-xs text-neutral-400">مجموع: {toFa(total)} کاربر</p>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </CardBody>
    </Card>
  );
}
