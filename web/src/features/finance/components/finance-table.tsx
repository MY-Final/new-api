import type { OnChangeFn, PaginationState } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePage,
  DataTableViewOptions,
  useDataTable,
} from '@/components/data-table'

import type {
  FinanceAction,
  FinanceFilters,
  FinanceRecord,
  FinanceSection,
} from '../types'
import { useFinanceColumns } from './finance-columns'
import { FinanceFilterBar } from './finance-filter-bar'

export function FinanceTable(props: {
  section: FinanceSection
  filters: FinanceFilters
  setFilters: (value: FinanceFilters) => void
  items: FinanceRecord[]
  total: number
  isLoading: boolean
  isFetching: boolean
  onAction: (action: FinanceAction) => void
  onRefresh: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const columns = useFinanceColumns(
    props.section,
    props.onAction,
    props.onRefresh
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
    columnVisibilityStorageKey: `finance:${props.section}:column-visibility`,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      emptyTitle={t('No financial records found')}
      applyHeaderSize
      skeletonKeyPrefix={`finance-${props.section}-skeleton`}
      className={props.className}
      toolbar={
        <div className='flex flex-wrap items-start gap-2'>
          <FinanceFilterBar
            section={props.section}
            filters={props.filters}
            setFilters={props.setFilters}
            className='min-w-0 flex-1'
          />
          <DataTableViewOptions table={table} />
        </div>
      }
    />
  )
}
