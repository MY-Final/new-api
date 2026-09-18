import type { OnChangeFn, PaginationState } from '@tanstack/react-table'
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePage,
  DataTableViewOptions,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import type { AffiliateRebate } from '@/features/wallet/types'

import {
  getSourceLabel,
  getSourceOptions,
  getStatusLabel,
  getStatusOptions,
} from '../lib/labels'
import type { AffiliateRebateFilters } from '../types'
import { useAffiliateRebateColumns } from './affiliate-rebate-columns'

export function AffiliateRebatesTable(props: {
  filters: AffiliateRebateFilters
  setFilters: (value: AffiliateRebateFilters) => void
  items: AffiliateRebate[]
  total: number
  isLoading: boolean
  isFetching: boolean
}) {
  const { t } = useTranslation()
  const columns = useAffiliateRebateColumns()
  const [range, setRange] = useState<{ start?: Date; end?: Date }>({})

  const sourceOptions = getSourceOptions(t)
  const statusOptions = getStatusOptions(t)
  const hasActiveFilters = Boolean(
    props.filters.sourceType ||
    props.filters.status ||
    props.filters.startTime ||
    props.filters.endTime
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
    columnVisibilityStorageKey: 'affiliate-rebates:column-visibility',
  })

  const selectFilter = (
    key: keyof AffiliateRebateFilters,
    value: string | null | undefined
  ) => {
    props.setFilters({
      ...props.filters,
      page: 1,
      [key]: value === 'all' ? undefined : value || undefined,
    })
  }

  const clearFilters = () => {
    setRange({})
    props.setFilters({ page: 1, pageSize: props.filters.pageSize })
  }

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      emptyTitle={t('No referral rebates found')}
      applyHeaderSize
      skeletonKeyPrefix='affiliate-rebates-skeleton'
      toolbar={
        <div className='flex flex-wrap items-start gap-2'>
          <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
            <Select
              items={sourceOptions}
              value={props.filters.sourceType || 'all'}
              onValueChange={(value) => selectFilter('sourceType', value)}
            >
              <SelectTrigger className='w-full sm:w-44'>
                <SelectValue>
                  {getSourceLabel(props.filters.sourceType || 'all', t)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {sourceOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              items={statusOptions}
              value={props.filters.status || 'all'}
              onValueChange={(value) => selectFilter('status', value)}
            >
              <SelectTrigger className='w-full sm:w-36'>
                <SelectValue>
                  {getStatusLabel(props.filters.status || 'all', t)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <CompactDateTimeRangePicker
              start={range.start}
              end={range.end}
              className='w-full sm:w-72'
              onChange={(next) => {
                setRange(next)
                props.setFilters({
                  ...props.filters,
                  page: 1,
                  startTime: next.start
                    ? Math.floor(next.start.getTime() / 1000)
                    : undefined,
                  endTime: next.end
                    ? Math.floor(next.end.getTime() / 1000)
                    : undefined,
                })
              }}
            />
            {hasActiveFilters ? (
              <Button
                variant='ghost'
                size='sm'
                className='text-muted-foreground'
                onClick={clearFilters}
              >
                <X aria-hidden='true' />
                {t('Clear filters')}
              </Button>
            ) : null}
          </div>
          <DataTableViewOptions table={table} />
        </div>
      }
    />
  )
}
