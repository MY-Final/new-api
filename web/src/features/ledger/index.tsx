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
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { useDebounce } from '@/hooks/use-debounce'
import { getRollingDateRange } from '@/lib/time'

import {
  createDefaultLedgerFilters,
  getQuotaLedgerDaily,
  getQuotaLedgerSummary,
} from './api'
import { LedgerSummaryCards } from './components/ledger-summary-cards'
import { LedgerTable } from './components/ledger-table'
import type { LedgerFilters } from './types'

export function Ledger() {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<LedgerFilters>(() =>
    createDefaultLedgerFilters()
  )
  const [range, setRange] = useState(() => getRollingDateRange(0))
  const debouncedUsername = useDebounce(filters.username, 300)
  const queryFilters = useMemo(
    () => ({ ...filters, username: debouncedUsername.trim() }),
    [filters, debouncedUsername]
  )

  const dailyQuery = useQuery({
    queryKey: ['ledger', 'daily', queryFilters],
    queryFn: () => getQuotaLedgerDaily(queryFilters),
    placeholderData: (previous) => previous,
  })
  const summaryQuery = useQuery({
    queryKey: [
      'ledger',
      'summary',
      queryFilters.startDate,
      queryFilters.endDate,
    ],
    queryFn: () => getQuotaLedgerSummary(queryFilters),
    placeholderData: (previous) => previous,
  })

  const handleRangeChange = (next: { start?: Date; end?: Date }) => {
    if (!next.start || !next.end) return
    setRange({ start: next.start, end: next.end })
    setFilters((current) => ({
      ...current,
      page: 1,
      startDate: dayjs(next.start).format('YYYY-MM-DD'),
      endDate: dayjs(next.end).format('YYYY-MM-DD'),
    }))
  }

  const handleClearFilters = () => {
    setRange(getRollingDateRange(0))
    setFilters((current) => ({
      ...createDefaultLedgerFilters(),
      pageSize: current.pageSize,
    }))
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('General Ledger')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-3'>
          <LedgerSummaryCards
            summary={summaryQuery.data}
            loading={summaryQuery.isLoading}
            error={summaryQuery.isError}
          />
          <LedgerTable
            filters={filters}
            setFilters={setFilters}
            range={range}
            onRangeChange={handleRangeChange}
            onClearFilters={handleClearFilters}
            items={dailyQuery.data?.items ?? []}
            total={dailyQuery.data?.total ?? 0}
            isLoading={dailyQuery.isLoading}
            isFetching={dailyQuery.isFetching}
            className='min-h-0 flex-1'
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
