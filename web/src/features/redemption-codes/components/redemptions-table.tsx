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
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { createServerError } from '@/lib/server-error-message'

import { getRedemptions, getRedemptionSummary, searchRedemptions } from '../api'
import {
  ERROR_MESSAGES,
  REDEMPTION_FILTER_EXPIRED,
  REDEMPTION_STATUS,
  getRedemptionStatusOptions,
  getRedemptionTypeOptions,
} from '../constants'
import { isRedemptionExpired } from '../lib'
import type { Redemption } from '../types'
import { DataTableBulkActions } from './data-table-bulk-actions'
import { useRedemptionsColumns } from './redemptions-columns'
import { RedemptionsMobileList } from './redemptions-mobile-list'
import { RedemptionsSummaryCards } from './redemptions-summary-cards'
import { useRedemptions } from './redemptions-provider'

const route = getRouteApi('/_authenticated/redemption-codes/')

function isDisabledRedemptionRow(redemption: Redemption) {
  return (
    redemption.status !== REDEMPTION_STATUS.ENABLED ||
    isRedemptionExpired(redemption.expired_time, redemption.status)
  )
}

export function RedemptionsTable() {
  const { t } = useTranslation()
  const columns = useRedemptionsColumns()
  const { refreshTrigger } = useRedemptions()
  const isMobile = useMediaQuery('(max-width: 640px)')

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      { columnId: 'status', searchKey: 'status', type: 'array' },
      { columnId: 'type', searchKey: 'type', type: 'array' },
    ],
  })
  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) ?? []
  const statusFilterValue = statusFilter[0] ?? ''
  const typeFilterValue =
    (
      columnFilters.find((filter) => filter.id === 'type')?.value as
        | string[]
        | undefined
    )?.[0] ?? ''

  // Fetch data with React Query
  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'redemptions',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      statusFilterValue,
      typeFilterValue,
      refreshTrigger,
    ],
    queryFn: async () => {
      const hasFilter = globalFilter?.trim()
      const hasStatusFilter = statusFilterValue !== ''
      const hasTypeFilter = typeFilterValue !== ''
      const params = {
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }

      const result =
        hasFilter || hasStatusFilter || hasTypeFilter
          ? await searchRedemptions({
              ...params,
              keyword: globalFilter,
              status: statusFilterValue,
              type: typeFilterValue as 'paid' | 'reward',
            })
          : await getRedemptions(params)

      if (!result.success) {
        throw createServerError(
          result,
          t(
            hasFilter || hasStatusFilter || hasTypeFilter
              ? ERROR_MESSAGES.SEARCH_FAILED
              : ERROR_MESSAGES.LOAD_FAILED
          )
        )
      }

      return {
        items: result.data?.items || [],
        total: result.data?.total || 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const redemptions = data?.items || []

  // Summary shares the list filters so the cards never disagree with the rows.
  const summaryQuery = useQuery({
    queryKey: [
      'redemptions',
      'summary',
      globalFilter,
      statusFilterValue,
      typeFilterValue,
      refreshTrigger,
    ],
    queryFn: () =>
      getRedemptionSummary({
        keyword: globalFilter,
        status: statusFilterValue,
        type: typeFilterValue as 'paid' | 'reward',
      }),
    placeholderData: (previousData) => previousData,
  })

  const { table } = useDataTable({
    data: redemptions,
    columns,
    enableRowSelection: true,
    getRowId: (row) => String(row.id),
    columnFilters,
    globalFilter,
    pagination,
    globalFilterFn: (row, _columnId, filterValue) => {
      const name = String(row.getValue('name')).toLowerCase()
      const id = String(row.getValue('id'))
      const searchValue = String(filterValue).toLowerCase()

      return name.includes(searchValue) || id.includes(searchValue)
    },
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: data?.total || 0,
    ensurePageInRange,
  })

  const redemptionStatusOptions = useMemo(() => {
    const counts: Record<string, number> = {
      [String(REDEMPTION_STATUS.ENABLED)]: summaryQuery.data?.available ?? 0,
      [String(REDEMPTION_STATUS.DISABLED)]: summaryQuery.data?.disabled ?? 0,
      [String(REDEMPTION_STATUS.USED)]: summaryQuery.data?.used ?? 0,
      [String(REDEMPTION_STATUS.REFUNDED)]: summaryQuery.data?.refunded ?? 0,
      [REDEMPTION_FILTER_EXPIRED]: summaryQuery.data?.expired ?? 0,
    }
    return getRedemptionStatusOptions(t).map((option) => ({
      ...option,
      count: counts[option.value] ?? 0,
    }))
  }, [t, summaryQuery.data])
  const redemptionTypeOptions = useMemo(() => {
    const counts: Record<string, number> = {
      paid: summaryQuery.data?.paid ?? 0,
      reward: summaryQuery.data?.reward ?? 0,
    }
    return getRedemptionTypeOptions(t).map((option) => ({
      ...option,
      count: counts[option.value] ?? 0,
    }))
  }, [t, summaryQuery.data])

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <RedemptionsSummaryCards
        summary={summaryQuery.data}
        loading={summaryQuery.isLoading}
        error={summaryQuery.isError}
      />
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No Redemption Codes Found')}
        emptyDescription={t(
          'No redemption codes available. Create your first redemption code to get started.'
        )}
        skeletonKeyPrefix='redemptions-skeleton'
        applyHeaderSize
        className='min-h-0 flex-1'
        toolbarProps={{
          searchPlaceholder: t('Filter by name or ID...'),
          searchDebounceMs: 500,
          filters: [
            {
              columnId: 'status',
              title: t('Status'),
              options: redemptionStatusOptions,
              singleSelect: true,
            },
            {
              columnId: 'type',
              title: t('Type'),
              options: redemptionTypeOptions,
              singleSelect: true,
            },
          ],
        }}
        mobile={<RedemptionsMobileList table={table} isLoading={isLoading} />}
        getRowClassName={(row, { isMobile }) => {
          if (!isDisabledRedemptionRow(row.original)) return undefined
          return isMobile ? DISABLED_ROW_MOBILE : DISABLED_ROW_DESKTOP
        }}
        bulkActions={<DataTableBulkActions table={table} />}
      />
    </div>
  )
}
