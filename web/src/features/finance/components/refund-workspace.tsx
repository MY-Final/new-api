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
import type { PaginationState } from '@tanstack/react-table'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatQuotaPrecise } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { createRefundBatch, getRefundQueue } from '../api'
import { canRefundRequest, formatRefundReason } from '../lib/request-refund'
import type { RefundQueueFilters, RequestBilling } from '../types'
import { RefundBatches } from './refund-batches'
import { RefundNavigation } from './refund-navigation'
import { RefundQueueFilterBar } from './refund-queue-filters'
import { RefundQueueTable } from './refund-queue-table'
import { RefundReasonFields } from './refund-reason'

export function RefundWorkspace(props: { initialRequestId?: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('requests')
  const [filters, setFilters] = useState<RefundQueueFilters>({
    request_id: props.initialRequestId,
    status: 'unrefunded',
  })
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [selected, setSelected] = useState<Record<string, RequestBilling>>({})
  const [preview, setPreview] = useState<{
    records: RequestBilling[]
    clientId: string
  } | null>(null)
  const [reason, setReason] = useState('')
  const [reasonDetails, setReasonDetails] = useState('')
  const query = useQuery({
    queryKey: ['finance', 'refund-queue', filters, pagination],
    queryFn: () =>
      getRefundQueue(filters, pagination.pageIndex + 1, pagination.pageSize),
    enabled: tab === 'requests',
    meta: { errorToast: false },
  })
  const select = useCallback((records: RequestBilling[], checked: boolean) => {
    setSelected((old) => {
      if (
        checked &&
        Object.keys(old).length +
          records.filter((record) => !old[record.billing_id]).length >
          200
      ) {
        return old
      }
      const next = { ...old }
      for (const record of records) {
        if (!checked) delete next[record.billing_id]
        else next[record.billing_id] = record
      }
      return next
    })
  }, [])
  const mutation = useMutation({
    mutationFn: (input: {
      billingIds: string[]
      reason: string
      clientId: string
    }) => createRefundBatch(input.billingIds, input.reason, input.clientId),
    onSuccess: () => {
      setPreview(null)
      setSelected({})
      setTab('batches')
      toast.success(t('Refund batch created'))
      void queryClient.invalidateQueries({ queryKey: ['finance'] })
    },
    onError: (error) =>
      handleServerError(error, t('Financial operation failed')),
  })
  const eligible = (query.data?.items || []).filter(canRefundRequest)
  const allSelected =
    eligible.length > 0 &&
    eligible.every((record) => !!selected[record.billing_id])
  const records = Object.values(selected)
  const pageExceedsLimit =
    records.length +
      eligible.filter((record) => !selected[record.billing_id]).length >
    200
  const totals = { bonus: 0, paid: 0, subscription: 0, total: 0 }
  for (const record of preview?.records || []) {
    totals.total += record.quota
    if (record.funding_source === 'subscription') {
      totals.subscription += record.quota
    } else {
      totals.bonus += record.bonus_quota
      totals.paid += record.paid_quota
    }
  }
  const safeTotals = Object.values(totals).every(Number.isSafeInteger)
  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Refund center')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(String(value))
              if (value === 'requests') void query.refetch()
            }}
            className='h-full min-h-0 gap-3'
          >
            <RefundNavigation active='requests' />
            <div className='flex shrink-0 flex-wrap items-center justify-between gap-2'>
              <TabsList>
                <TabsTrigger value='requests'>
                  {t('Request charges')}
                </TabsTrigger>
                <TabsTrigger value='batches'>{t('Refund batches')}</TabsTrigger>
              </TabsList>
              <span className='text-muted-foreground text-xs'>
                {t('Consumption quota refunds')}
              </span>
            </div>
            <TabsContent
              value='requests'
              keepMounted
              className='flex min-h-0 flex-col gap-3 data-hidden:hidden'
            >
              <RefundQueueFilterBar
                initialRequestId={props.initialRequestId}
                onApply={(value) => {
                  setFilters(value)
                  setPagination({ ...pagination, pageIndex: 0 })
                  setSelected({})
                }}
              />
              <div className='bg-muted/50 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2'>
                <div>
                  <div className='mb-1 flex items-center gap-2 text-xs'>
                    <Checkbox
                      aria-label={t('Select refundable on this page')}
                      checked={allSelected}
                      disabled={
                        !eligible.length ||
                        query.isFetching ||
                        (!allSelected && pageExceedsLimit)
                      }
                      onCheckedChange={(checked) => select(eligible, !!checked)}
                    />
                    <span>{t('Select refundable on this page')}</span>
                  </div>
                  <p className='text-sm'>
                    {t('{{count}} requests selected', {
                      count: records.length,
                    })}
                    <span className='text-muted-foreground ml-2 text-xs'>
                      {t(
                        'Up to 200 per batch; selection is kept across pages.'
                      )}
                    </span>
                  </p>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {t(
                      'Settled charges return in full to their original funding source. Subscription period restrictions still apply.'
                    )}
                  </p>
                </div>
                <div className='flex gap-2'>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={!records.length}
                    onClick={() => setSelected({})}
                  >
                    {t('Clear selection')}
                  </Button>
                  <Button
                    size='sm'
                    disabled={
                      !records.length || query.isFetching || query.isError
                    }
                    onClick={() => {
                      mutation.reset()
                      setReason('')
                      setReasonDetails('')
                      setPreview({ records, clientId: crypto.randomUUID() })
                    }}
                  >
                    {t('Preview refund')} ({records.length})
                  </Button>
                </div>
              </div>
              {query.isError ? (
                <ErrorState
                  title={getServerErrorMessage(query.error)}
                  onRetry={() => void query.refetch()}
                />
              ) : (
                <RefundQueueTable
                  records={query.data?.items || []}
                  total={query.data?.total || 0}
                  pagination={pagination}
                  onPaginationChange={(value) =>
                    setPagination({
                      ...value,
                      pageIndex:
                        value.pageSize === pagination.pageSize
                          ? value.pageIndex
                          : 0,
                    })
                  }
                  selected={selected}
                  selectionLimitReached={records.length >= 200}
                  onSelect={select}
                  isLoading={query.isLoading}
                  isFetching={query.isFetching}
                />
              )}
            </TabsContent>
            <TabsContent value='batches' className='flex min-h-0 flex-col'>
              <RefundBatches />
            </TabsContent>
          </Tabs>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <ConfirmDialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setPreview(null)
        }}
        title={t('Confirm refund operation')}
        desc={t('Refund {{count}} requests for a total of {{amount}}.', {
          count: preview?.records.length || 0,
          amount: formatQuotaPrecise(totals.total),
        })}
        className='data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-3xl'
        confirmText={t('Confirm and refund')}
        isLoading={mutation.isPending}
        disabled={!reason.trim() || !safeTotals}
        handleConfirm={() => {
          if (preview && reason.trim() && safeTotals) {
            mutation.mutate(
              mutation.isError && mutation.variables
                ? mutation.variables
                : {
                    billingIds: preview.records.map(
                      (record) => record.billing_id
                    ),
                    reason: formatRefundReason(reason, reasonDetails),
                    clientId: preview.clientId,
                  }
            )
          }
        }}
      >
        {safeTotals ? (
          <dl className='bg-muted/50 grid grid-cols-2 gap-3 rounded-lg p-3 sm:grid-cols-4'>
            {[
              { label: t('Total'), amount: totals.total },
              { label: t('Bonus quota'), amount: totals.bonus },
              { label: t('Paid quota'), amount: totals.paid },
              { label: t('Subscription'), amount: totals.subscription },
            ].map((item) => (
              <div key={item.label}>
                <dt className='text-muted-foreground text-xs'>{item.label}</dt>
                <dd className='mt-1 text-sm font-medium tabular-nums'>
                  {formatQuotaPrecise(item.amount)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p role='alert' className='text-destructive'>
            {t('The total is too large. Select fewer requests.')}
          </p>
        )}
        <div className='max-h-[35vh] overflow-auto'>
          <StaticDataTable
            data={preview?.records || []}
            getRowKey={(record) => record.billing_id}
            columns={[
              {
                id: 'request',
                header: t('Request ID'),
                cell: (record) => (
                  <div className='max-w-64 break-all whitespace-normal'>
                    {record.request_id || record.billing_id}
                    <p className='text-muted-foreground text-xs'>
                      {record.username}
                    </p>
                  </div>
                ),
              },
              {
                id: 'amount',
                header: t('Refund amount'),
                cell: (record) => formatQuotaPrecise(record.quota),
              },
              {
                id: 'destination',
                header: t('Refund destination'),
                cell: (record) =>
                  record.funding_source === 'subscription'
                    ? `${t('Subscription')} #${record.subscription_id}`
                    : t('Wallet'),
              },
            ]}
          />
        </div>
        <RefundReasonFields
          id='batch-refund-reason'
          reason={reason}
          details={reasonDetails}
          onReasonChange={setReason}
          onDetailsChange={setReasonDetails}
          disabled={mutation.isPending || mutation.isError}
        />
        {mutation.isError ? (
          <p role='alert' className='text-destructive text-sm'>
            {getServerErrorMessage(mutation.error)} ·{' '}
            {t('Retry to check the same submission safely.')}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
