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
import type { ColumnDef, PaginationState } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Checkbox } from '@/components/ui/checkbox'
import { formatQuotaPrecise, formatTimestampToDate } from '@/lib/format'

import { canRefundRequest } from '../lib/request-refund'
import type { RequestBilling } from '../types'
import { RefundReasonBadge } from './refund-reason'

export function RefundQueueTable(props: {
  records: RequestBilling[]
  total: number
  pagination: PaginationState
  onPaginationChange: (pagination: PaginationState) => void
  selected: Record<string, RequestBilling>
  selectionLimitReached: boolean
  onSelect: (records: RequestBilling[], checked: boolean) => void
  isLoading: boolean
  isFetching: boolean
}) {
  const { t } = useTranslation()
  const columns: ColumnDef<RequestBilling>[] = [
    {
      id: 'selection',
      size: 44,
      header: t('Selected'),
      cell: ({ row }) => (
        <Checkbox
          aria-label={t('Select {{request}}', {
            request: row.original.request_id || row.original.billing_id,
          })}
          checked={!!props.selected[row.original.billing_id]}
          disabled={
            !canRefundRequest(row.original) ||
            props.isFetching ||
            (props.selectionLimitReached &&
              !props.selected[row.original.billing_id])
          }
          onCheckedChange={(checked) =>
            props.onSelect([row.original], !!checked)
          }
        />
      ),
    },
    {
      id: 'request',
      header: t('Request'),
      size: 270,
      cell: ({ row }) => (
        <div className='space-y-1'>
          <div className='flex items-center gap-1'>
            <span className='truncate font-mono text-xs'>
              {row.original.request_id || row.original.billing_id}
            </span>
            <CopyButton
              value={row.original.request_id || row.original.billing_id}
            />
          </div>
          <span className='text-muted-foreground text-xs'>
            {formatTimestampToDate(row.original.created_at)}
          </span>
        </div>
      ),
    },
    {
      id: 'user',
      header: t('User'),
      cell: ({ row }) => (
        <div>
          <p>{row.original.username}</p>
          <p className='text-muted-foreground text-xs'>
            #{row.original.user_id}
          </p>
        </div>
      ),
    },
    {
      id: 'model',
      header: t('Model'),
      cell: ({ row }) => (
        <div>
          <p className='truncate'>{row.original.model_name}</p>
          <p className='text-muted-foreground text-xs'>
            {t('Channel ID')}: {row.original.channel_id || '-'}
          </p>
        </div>
      ),
    },
    {
      id: 'quota',
      header: t('Refund amount'),
      cell: ({ row }) => (
        <span className='tabular-nums'>
          {formatQuotaPrecise(row.original.quota)}
        </span>
      ),
    },
    {
      id: 'funding',
      header: t('Refund destination'),
      size: 220,
      cell: ({ row }) =>
        row.original.funding_source === 'subscription' ? (
          <span>
            {t('Subscription')} #{row.original.subscription_id}
          </span>
        ) : (
          <div className='text-xs'>
            <p>
              {t('Bonus quota')}: {formatQuotaPrecise(row.original.bonus_quota)}
            </p>
            <p>
              {t('Paid quota')}: {formatQuotaPrecise(row.original.paid_quota)}
            </p>
          </div>
        ),
    },
    {
      id: 'status',
      header: t('Status'),
      size: 240,
      cell: ({ row }) => {
        const record = row.original
        if (record.refund_operation_id > 0 || record.refunded_quota > 0) {
          return (
            <StatusBadge
              copyable={false}
              variant='neutral'
              label={t('Refunded')}
            />
          )
        }
        if (!canRefundRequest(record)) {
          return (
            <div className='space-y-1'>
              <StatusBadge
                copyable={false}
                variant='warning'
                label={t('Unavailable')}
              />
              <p className='text-muted-foreground text-xs whitespace-normal'>
                {record.blocked_reason
                  ? t(record.blocked_reason)
                  : t('Pending')}
              </p>
            </div>
          )
        }
        return (
          <StatusBadge
            copyable={false}
            variant='success'
            label={t('Refundable')}
          />
        )
      },
    },
    {
      id: 'refund_reason',
      header: t('Refund reason'),
      size: 200,
      cell: ({ row }) => (
        <RefundReasonBadge reason={row.original.refund_reason} />
      ),
    },
  ]
  const { table } = useDataTable({
    data: props.records,
    columns,
    manualPagination: true,
    totalCount: props.total,
    pagination: props.pagination,
    onPaginationChange: (updater) =>
      props.onPaginationChange(
        typeof updater === 'function' ? updater(props.pagination) : updater
      ),
    getRowId: (record) => record.billing_id,
  })
  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      toolbarProps={null}
      emptyTitle={t('No matching request charges')}
      emptyDescription={t(
        'Adjust the filters. Historical requests without billing snapshots are unavailable.'
      )}
      className='min-h-0 flex-1'
    />
  )
}
