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
import { Link } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { dateToUnixTimestamp, getRollingDateRange } from '@/lib/time'

import { getMyUsage } from './api'
import { TodayUsageStrip, UsageOverview } from './components/usage-overview'
import { UsageRequestsTable } from './components/usage-requests-table'
import { getDefaultUsageRange, isRangeCoveringToday } from './lib/usage-range'

const MAX_USAGE_RANGE_DAYS = 31

export function UsageStatistics() {
  const { t } = useTranslation()
  const [range, setRange] = useState(() => getDefaultUsageRange())
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
  const showTodayStrip = !isRangeCoveringToday(range)

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
    enabled: showTodayStrip,
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
  const hasUsage = (usageQuery.data?.summary.request_count ?? 0) > 0
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
  } else if (usageQuery.data && hasUsage) {
    usageContent = <UsageOverview data={usageQuery.data} range={range} />
  } else if (usageQuery.data) {
    usageContent = (
      <EmptyState
        bordered
        icon={KeyRound}
        title={t('No usage data')}
        description={t(
          'Usage appears here after you make your first API request.'
        )}
        action={
          <Button render={<Link to='/keys' />}>{t('Create API Key')}</Button>
        }
      />
    )
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
          {showTodayStrip && <TodayUsageStrip summary={today} />}

          {usageContent}

          {(!usageQuery.data || hasUsage) && (
            <section className='space-y-2'>
              <h3 className='text-sm font-semibold'>{t('Request Details')}</h3>
              <UsageRequestsTable
                key={`${selectedParams.start_timestamp}-${selectedParams.end_timestamp}`}
                endpoint='/api/statistics/my/requests'
                params={selectedParams}
                queryKey='my-requests'
              />
            </section>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
