/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { formatNumber, formatQuota } from '@/lib/format'
import { dateToUnixTimestamp, getRollingDateRange } from '@/lib/time'

import { getMyUsage } from './api'
import { UsageMetric, UsageOverview } from './components/usage-overview'
import { UsageRequestsTable } from './components/usage-requests-table'

const MAX_USAGE_RANGE_DAYS = 31

export function UsageStatistics() {
  const { t } = useTranslation()
  const [range, setRange] = useState(() => getRollingDateRange(30))
  const selectedParams = useMemo(
    () => ({
      start_timestamp: dateToUnixTimestamp(range.start),
      end_timestamp: dateToUnixTimestamp(range.end),
    }),
    [range]
  )
  const todayParams = useMemo(() => {
    const today = getRollingDateRange(0)
    return {
      start_timestamp: dateToUnixTimestamp(today.start),
      end_timestamp: dateToUnixTimestamp(today.end),
    }
  }, [])

  const todayQuery = useQuery({
    queryKey: ['usage-statistics', 'my', 'today', todayParams],
    queryFn: async () => {
      const result = await getMyUsage(todayParams)
      if (!result.success || !result.data) {
        throw new Error(result.message || t('Failed to load usage details'))
      }
      return result.data
    },
    staleTime: 30_000,
  })
  const usageQuery = useQuery({
    queryKey: ['usage-statistics', 'my', selectedParams],
    queryFn: async () => {
      const result = await getMyUsage(selectedParams)
      if (!result.success || !result.data) {
        throw new Error(result.message || t('Failed to load usage details'))
      }
      return result.data
    },
    staleTime: 30_000,
  })

  const handleRangeChange = (nextRange: { start?: Date; end?: Date }) => {
    if (!nextRange.start || !nextRange.end) return
    const rangeSeconds =
      dateToUnixTimestamp(nextRange.end) - dateToUnixTimestamp(nextRange.start)
    if (rangeSeconds < 0 || rangeSeconds > MAX_USAGE_RANGE_DAYS * 86400) {
      toast.error(
        t('Date range cannot exceed {{days}} days', {
          days: MAX_USAGE_RANGE_DAYS,
        })
      )
      return
    }
    setRange({ start: nextRange.start, end: nextRange.end })
  }

  const today = todayQuery.data?.summary
  let usageContent: ReactNode
  if (usageQuery.isError) {
    usageContent = (
      <ErrorState
        title={t('Failed to load usage details')}
        description={
          usageQuery.error instanceof Error
            ? usageQuery.error.message
            : undefined
        }
        onRetry={() => usageQuery.refetch()}
      />
    )
  } else if (usageQuery.data) {
    usageContent = <UsageOverview data={usageQuery.data} />
  } else {
    usageContent = (
      <div className='text-muted-foreground rounded-lg border p-8 text-center text-sm'>
        {t('Loading...')}
      </div>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Usage Statistics')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <CompactDateTimeRangePicker
          start={range.start}
          end={range.end}
          onChange={handleRangeChange}
          maxRangeDays={MAX_USAGE_RANGE_DAYS}
          className='w-full sm:w-80'
        />
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-7xl space-y-4'>
          <section className='space-y-2'>
            <h3 className='text-sm font-semibold'>{t('Today')}</h3>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
              <UsageMetric
                label={t('Requests')}
                value={formatNumber(today?.request_count ?? 0)}
              />
              <UsageMetric
                label={t('Input Tokens')}
                value={formatNumber(today?.input_tokens ?? 0)}
              />
              <UsageMetric
                label={t('Output Tokens')}
                value={formatNumber(today?.output_tokens ?? 0)}
              />
              <UsageMetric
                label={t('Cache Tokens')}
                value={formatNumber(
                  (today?.cache_read_tokens ?? 0) +
                    (today?.cache_write_tokens ?? 0)
                )}
              />
              <UsageMetric
                label={t('Total Tokens')}
                value={formatNumber(today?.total_tokens ?? 0)}
              />
              <UsageMetric
                label={t('User Cost')}
                value={formatQuota(today?.user_cost ?? 0)}
              />
            </div>
          </section>

          {usageContent}

          <section className='space-y-2'>
            <h3 className='text-sm font-semibold'>{t('Request Details')}</h3>
            <UsageRequestsTable
              key={`${selectedParams.start_timestamp}-${selectedParams.end_timestamp}`}
              endpoint='/api/statistics/my/requests'
              params={selectedParams}
              queryKey='my-requests'
            />
          </section>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
