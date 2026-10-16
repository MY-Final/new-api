/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { formatQuotaPrecise, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getRefundBatches, retryRefundBatch } from '../api'
import type { RefundBatch } from '../types'
import { RefundReasonBadge } from './refund-reason'

export function RefundBatches() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [detailId, setDetailId] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['finance', 'refund-batches', page],
    queryFn: () => getRefundBatches(page),
    refetchInterval: (current) =>
      current.state.data?.items.some(
        (batch) => batch.status === 'pending' || batch.status === 'running'
      )
        ? 2000
        : false,
    meta: { errorToast: false },
  })
  const retry = useMutation({
    mutationFn: (input: { taskId: string; clientId: string }) =>
      retryRefundBatch(input.taskId, input.clientId),
    onSuccess: () => {
      setDetailId(null)
      setPage(1)
      void queryClient.invalidateQueries({ queryKey: ['finance'] })
    },
    onError: (error) =>
      handleServerError(error, t('Financial operation failed')),
  })
  const seenCompleted = useRef(new Set<string>())
  useEffect(() => {
    const completed = (query.data?.items || []).filter(
      (batch) => batch.status === 'succeeded' || batch.status === 'failed'
    )
    if (!completed.some((batch) => !seenCompleted.current.has(batch.task_id))) {
      return
    }
    for (const batch of completed) seenCompleted.current.add(batch.task_id)
    void queryClient.invalidateQueries({
      queryKey: ['finance'],
      predicate: (query) => query.queryKey[1] !== 'refund-batches',
    })
    for (const key of [
      'logs',
      'usage-logs-stats',
      'ledger',
      'self',
      'users',
      'user-usage',
      'usage-statistics',
      'quota-usage-daily',
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] })
    }
  }, [query.data, queryClient])
  const batches = query.data?.items || []
  const detail = batches.find((batch) => batch.task_id === detailId)
  const statusLabels = {
    pending: t('Pending'),
    running: t('Processing'),
    succeeded: t('Succeeded'),
    failed: t('Failed'),
  }
  const renderStatus = (batch: RefundBatch) => (
    <StatusBadge
      copyable={false}
      variant={batch.status === 'succeeded' ? 'success' : 'neutral'}
      label={statusLabels[batch.status]}
    />
  )
  const pages = Math.max(1, Math.ceil((query.data?.total || 0) / 10))
  return (
    <div className='min-h-0 flex-1 overflow-y-auto'>
      <p className='text-muted-foreground mb-3 text-sm'>
        {t(
          'Batches continue in the background. Reopen this page to review progress and retry unfinished items.'
        )}
      </p>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState
          title={getServerErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {!query.isLoading && !query.isError && !batches.length ? (
        <EmptyState title={t('No refund batches yet')} />
      ) : null}
      <div className='space-y-3'>
        {batches.map((batch) => (
          <article key={batch.task_id} className='rounded-xl border p-4'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div className='min-w-0 space-y-1'>
                <div className='flex items-center gap-2'>
                  {renderStatus(batch)}
                  <span className='text-muted-foreground text-xs'>
                    {formatTimestampToDate(batch.created_at)}
                  </span>
                </div>
                <div className='flex min-w-0 items-center gap-1'>
                  <span className='truncate font-mono text-xs'>
                    {batch.task_id}
                  </span>
                  <CopyButton value={batch.task_id} />
                </div>
              </div>
              <Button
                size='sm'
                variant='outline'
                onClick={() => setDetailId(batch.task_id)}
              >
                {t('View results')}
              </Button>
            </div>
            <div className='my-2'>
              <RefundReasonBadge reason={batch.payload.reason} />
            </div>
            <p className='text-muted-foreground text-xs tabular-nums'>
              {t('Processed')}: {batch.state.processed}/{batch.state.total} ·{' '}
              {t('Succeeded')}: {batch.state.succeeded} · {t('Failed')}:{' '}
              {batch.state.failed}
            </p>
            <progress
              className='accent-primary mt-2 h-1.5 w-full'
              max={100}
              value={batch.state.progress}
              aria-label={t('Progress')}
            />
            {batch.error ? (
              <p className='text-destructive mt-2 text-sm'>{t(batch.error)}</p>
            ) : null}
          </article>
        ))}
      </div>
      {pages > 1 ? (
        <div className='flex items-center justify-between py-3'>
          <Button
            variant='outline'
            disabled={page <= 1 || query.isFetching}
            onClick={() => setPage(page - 1)}
          >
            {t('Previous page')}
          </Button>
          <span className='text-muted-foreground text-sm'>
            {page} / {pages}
          </span>
          <Button
            variant='outline'
            disabled={page >= pages || query.isFetching}
            onClick={() => setPage(page + 1)}
          >
            {t('Next page')}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open && !retry.isPending) setDetailId(null)
        }}
        title={t('Refund batch results')}
        description={detail?.payload.reason}
        contentClassName='sm:max-w-4xl'
      >
        {detail ? (
          <>
            <StaticDataTable
              data={detail.state.items}
              getRowKey={(item) => item.billing_id}
              columns={[
                {
                  id: 'request',
                  header: t('Request ID'),
                  cell: (item) => (
                    <div className='max-w-64 break-all whitespace-normal'>
                      {item.request_id || item.billing_id}
                      <p className='text-muted-foreground text-xs'>
                        {item.username}
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'amount',
                  header: t('Refund amount'),
                  cell: (item) => formatQuotaPrecise(item.quota),
                },
                {
                  id: 'reason',
                  header: t('Refund reason'),
                  cell: () => (
                    <RefundReasonBadge reason={detail.payload.reason} />
                  ),
                },
                {
                  id: 'result',
                  header: t('Result'),
                  cell: (item) => (
                    <div className='max-w-80 space-y-1 whitespace-normal'>
                      <p>{statusLabels[item.status]}</p>
                      {item.error ? (
                        <p className='text-destructive text-xs'>
                          {t(item.error)}
                        </p>
                      ) : null}
                      {item.operation_id ? (
                        <p className='text-muted-foreground text-xs'>
                          {t('Operation ID')}: #{item.operation_id}
                        </p>
                      ) : null}
                      {item.already_refunded ? (
                        <p className='text-muted-foreground text-xs'>
                          {t('This request has already been refunded')}
                        </p>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
            {detail.status === 'failed' &&
            detail.state.items.some((item) => item.status !== 'succeeded') ? (
              <div className='mt-3 flex justify-end'>
                <Button
                  disabled={retry.isPending}
                  onClick={() =>
                    retry.mutate(
                      retry.isError &&
                        retry.variables?.taskId === detail.task_id
                        ? retry.variables
                        : {
                            taskId: detail.task_id,
                            clientId: crypto.randomUUID(),
                          }
                    )
                  }
                >
                  {t('Retry unfinished items')}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </Dialog>
    </div>
  )
}
