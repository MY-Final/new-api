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
import { Link } from '@tanstack/react-router'
import { KeyRound, ScrollText } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { buildLogsDrilldownSearch } from '@/lib/logs-drilldown'
import { requireServerSuccess } from '@/lib/server-error-message'
import { getRollingDateRange } from '@/lib/time'
import { useAuthStore } from '@/stores/auth-store'

import { getUserQuotaDates } from '../../api'
import { buildQueryParams, detectQuickRangeDays } from '../../lib/filters'
import { buildDashboardAnalytics } from '../../lib/operations'
import type { DashboardChartPreferences, DashboardFilters } from '../../types'
import { ConsumptionDistributionChart } from './consumption-distribution-chart'
import { LogStatCards } from './log-stat-cards'
import { ModelCharts } from './model-charts'
import {
  PerformanceOverview,
  PerformanceSuccessCard,
} from './performance-overview'
import { PersonalBalanceCard } from './personal-balance-card'

interface ModelDashboardProps {
  isAdmin: boolean
  filters: DashboardFilters
  preferences: DashboardChartPreferences
  onFilterChange: (filters: DashboardFilters) => void
  refetchInterval: number | false
}

export function ModelDashboard(props: ModelDashboardProps) {
  const { t, i18n } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const usageFilters = props.isAdmin
    ? props.filters
    : { ...props.filters, username: undefined }
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const range = useMemo(
    () => ({
      start:
        props.filters.start_timestamp ??
        getRollingDateRange(props.preferences.defaultTimeRangeDays).start,
      end: props.filters.end_timestamp ?? new Date(),
    }),
    [
      props.filters.start_timestamp,
      props.filters.end_timestamp,
      props.preferences.defaultTimeRangeDays,
    ]
  )
  const granularity =
    props.filters.time_granularity ?? props.preferences.defaultTimeGranularity
  const currentRange = {
    start_timestamp: Math.floor(range.start.getTime() / 1000),
    end_timestamp: Math.floor(range.end.getTime() / 1000),
  }
  // The source floors the start to a complete hour bucket. Query from the
  // end of the previous first bucket so 30-day comparisons stay within the
  // self API limit while covering equal, nonoverlapping bucket counts.
  const firstBucket =
    currentRange.start_timestamp - (currentRange.start_timestamp % 3600)
  const lastBucket =
    currentRange.end_timestamp - (currentRange.end_timestamp % 3600)
  const previousRange = {
    start_timestamp: firstBucket - (lastBucket - firstBucket) - 1,
    end_timestamp: firstBucket - 1,
  }
  const query = useQuery({
    queryKey: [
      'dashboard-quota-dates',
      currentRange.start_timestamp,
      currentRange.end_timestamp,
      usageFilters.username ?? '',
      props.isAdmin,
      props.isAdmin ? undefined : userId,
    ],
    queryFn: async () =>
      requireServerSuccess(
        await getUserQuotaDates(
          buildQueryParams(currentRange, usageFilters),
          props.isAdmin
        )
      ).data ?? [],
    refetchInterval: props.refetchInterval,
    staleTime: 30_000,
    retry: false,
  })
  const previousQuery = useQuery({
    queryKey: [
      'dashboard-quota-dates-previous',
      previousRange.start_timestamp,
      previousRange.end_timestamp,
      usageFilters.username ?? '',
      props.isAdmin,
      props.isAdmin ? undefined : userId,
    ],
    queryFn: async () =>
      requireServerSuccess(
        await getUserQuotaDates(
          buildQueryParams(previousRange, usageFilters),
          props.isAdmin
        )
      ).data ?? [],
    refetchInterval: props.refetchInterval,
    staleTime: 60_000,
    retry: false,
  })
  const analytics = useMemo(
    () => buildDashboardAnalytics(query.data ?? [], granularity, range),
    [query.data, granularity, range]
  )
  const previous = useMemo(
    () =>
      previousQuery.data && !previousQuery.isError
        ? buildDashboardAnalytics(previousQuery.data, granularity, {
            start: new Date(previousRange.start_timestamp * 1000),
            end: new Date(previousRange.end_timestamp * 1000),
          }).summary
        : undefined,
    [
      previousQuery.data,
      previousQuery.isError,
      granularity,
      previousRange.start_timestamp,
      previousRange.end_timestamp,
    ]
  )
  const selectedDays = detectQuickRangeDays(range.start, range.end)
  const handleRangeChange = (next: { start?: Date; end?: Date }) => {
    if (!next.start || !next.end) return
    const seconds = (next.end.getTime() - next.start.getTime()) / 1000
    if (seconds < 0) {
      toast.error(t('End time must be after start time'))
      return
    }
    if (seconds > 30 * 86400) {
      toast.error(t('Date range cannot exceed {{days}} days', { days: 30 }))
      return
    }
    props.onFilterChange({
      ...props.filters,
      start_timestamp: next.start,
      end_timestamp: next.end,
      time_granularity: seconds <= 86400 ? 'hour' : 'day',
    })
  }
  const consumptionTrend = (
    <ConsumptionDistributionChart
      data={analytics}
      loading={query.isLoading}
      defaultChartType={props.preferences.consumptionDistributionChart}
      timeGranularity={granularity}
    />
  )

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <Badge variant='outline' className='max-w-full break-all'>
            {props.isAdmin
              ? props.filters.username || t('All users')
              : t('My usage')}
          </Badge>
          <div className='flex flex-wrap gap-1' aria-label={t('Quick Range')}>
            {[
              { days: 0, label: t('Today') },
              { days: 1, label: t('Last 24 hours') },
              { days: 7, label: t('7 Days') },
              { days: 30, label: t('30 Days') },
            ].map((preset) => (
              <Button
                key={preset.days}
                variant={selectedDays === preset.days ? 'secondary' : 'ghost'}
                size='sm'
                aria-pressed={selectedDays === preset.days}
                onClick={() =>
                  handleRangeChange(getRollingDateRange(preset.days))
                }
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
        <CompactDateTimeRangePicker
          start={range.start}
          end={range.end}
          onChange={handleRangeChange}
          maxRangeDays={30}
          className='sm:w-auto'
        />
      </div>
      <div
        className='grid grid-cols-2 gap-3 xl:grid-cols-4'
        aria-label={t('Period Summary')}
      >
        {!props.isAdmin && <PersonalBalanceCard />}
        <LogStatCards
          data={analytics}
          previous={previous}
          loading={query.isLoading}
          error={query.isError}
          personal={!props.isAdmin}
        />
        {props.isAdmin && (
          <PerformanceSuccessCard refetchInterval={props.refetchInterval} />
        )}
      </div>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 text-xs'>
          <span>
            {t('Models')}:{' '}
            {query.isLoading || query.isError
              ? '—'
              : formatNumber(analytics.models.length, locale)}
          </span>
          <span>{t('Usage totals are aggregated by hour')}</span>
        </div>
        {!props.isAdmin && (
          <div className='flex flex-wrap gap-2'>
            <Link
              to='/keys'
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <KeyRound aria-hidden='true' />
              {t('API Keys')}
            </Link>
            <Link
              to='/usage-logs/$section'
              params={{ section: 'common' }}
              search={buildLogsDrilldownSearch({
                start: range.start,
                end: range.end,
              })}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <ScrollText aria-hidden='true' />
              {t('Usage Logs')}
            </Link>
          </div>
        )}
      </div>
      {query.isError ? (
        <ErrorState
          title={t('Failed to load statistics')}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <div
            className={
              props.isAdmin
                ? 'grid min-w-0 gap-4 lg:grid-cols-2'
                : 'grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
            }
          >
            {props.isAdmin ? (
              <PerformanceOverview refetchInterval={props.refetchInterval} />
            ) : (
              consumptionTrend
            )}
            <ModelCharts
              key={props.preferences.modelRankingMetric}
              data={analytics.models}
              loading={query.isLoading}
              defaultMetric={props.preferences.modelRankingMetric}
              filters={{
                ...usageFilters,
                start_timestamp: range.start,
                end_timestamp: range.end,
              }}
              title={props.isAdmin ? undefined : t('My model usage')}
            />
          </div>
          {props.isAdmin && consumptionTrend}
        </>
      )}
    </div>
  )
}
