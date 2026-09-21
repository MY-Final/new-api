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
import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTableColumnHeader,
  DataTablePage,
  DataTableViewOptions,
  useDataTable,
} from '@/components/data-table'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { LedgerFilters, QuotaLedgerDailyItem } from '../types'
import { LedgerFilterBar } from './ledger-filter-bar'

function QuotaValue(props: { value: number; emphasis?: boolean }) {
  return (
    <span
      className={cn(
        'block text-right tabular-nums',
        props.emphasis && 'font-semibold',
        props.value < 0 && 'text-destructive'
      )}
    >
      {formatQuota(props.value)}
    </span>
  )
}

function formatUpdatedAt(seconds: number): string {
  if (!seconds) return '-'
  return new Date(seconds * 1000).toLocaleString()
}

export function LedgerTable(props: {
  filters: LedgerFilters
  setFilters: (value: LedgerFilters) => void
  range: { start?: Date; end?: Date }
  onRangeChange: (range: { start?: Date; end?: Date }) => void
  onClearFilters: () => void
  items: QuotaLedgerDailyItem[]
  total: number
  isLoading: boolean
  isFetching: boolean
  className?: string
}) {
  const { t } = useTranslation()
  useSystemConfigStore((state) => state.config.currency)

  const columns = useMemo<ColumnDef<QuotaLedgerDailyItem>[]>(
    () => [
      {
        id: 'date',
        accessorKey: 'date',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Date')} />
        ),
        meta: { label: t('Date') },
        cell: ({ row }) => (
          <span className='text-muted-foreground font-medium tabular-nums'>
            {row.original.date}
          </span>
        ),
        size: 120,
      },
      {
        id: 'username',
        accessorKey: 'username',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Username')} />
        ),
        meta: { label: t('Username') },
        cell: ({ row }) => (
          <span className='truncate font-medium'>
            {row.original.username || `#${row.original.user_id}`}
          </span>
        ),
        size: 180,
      },
      {
        id: 'bonus_quota',
        accessorKey: 'bonus_quota',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('Welfare quota')}
            className='justify-end'
          />
        ),
        meta: { label: t('Welfare quota') },
        cell: ({ row }) => <QuotaValue value={row.original.bonus_quota} />,
        size: 140,
      },
      {
        id: 'paid_quota',
        accessorKey: 'paid_quota',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('Paid quota')}
            className='justify-end'
          />
        ),
        meta: { label: t('Paid quota') },
        cell: ({ row }) => <QuotaValue value={row.original.paid_quota} />,
        size: 140,
      },
      {
        id: 'quota',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('Total')}
            className='justify-end'
          />
        ),
        meta: { label: t('Total') },
        cell: ({ row }) => (
          <QuotaValue
            emphasis
            value={row.original.bonus_quota + row.original.paid_quota}
          />
        ),
        size: 140,
      },
      {
        id: 'updated_at',
        accessorKey: 'updated_at',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Updated at')} />
        ),
        meta: { label: t('Updated at') },
        cell: ({ row }) => (
          <span className='text-muted-foreground text-xs whitespace-nowrap tabular-nums'>
            {formatUpdatedAt(row.original.updated_at)}
          </span>
        ),
        size: 180,
      },
    ],
    [t]
  )

  const pagination = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, props.filters.page - 1),
      pageSize: props.filters.pageSize,
    }),
    [props.filters.page, props.filters.pageSize]
  )

  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater(pagination) : updater
    const pageSizeChanged = next.pageSize !== pagination.pageSize
    props.setFilters({
      ...props.filters,
      page: pageSizeChanged ? 1 : next.pageIndex + 1,
      pageSize: next.pageSize,
    })
  }

  const { table } = useDataTable({
    data: props.items,
    columns,
    pagination,
    onPaginationChange,
    manualPagination: true,
    totalCount: props.total,
    columnVisibilityStorageKey: 'ledger:column-visibility',
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      emptyTitle={t('No ledger records found')}
      applyHeaderSize
      skeletonKeyPrefix='ledger-skeleton'
      className={props.className}
      toolbar={
        <div className='flex flex-wrap items-center gap-2'>
          <LedgerFilterBar
            start={props.range.start}
            end={props.range.end}
            username={props.filters.username}
            onRangeChange={props.onRangeChange}
            onUsernameChange={(value) =>
              props.setFilters({
                ...props.filters,
                page: 1,
                username: value,
              })
            }
            onClear={props.onClearFilters}
            className='min-w-0 flex-1'
          />
          <DataTableViewOptions table={table} />
        </div>
      }
    />
  )
}
