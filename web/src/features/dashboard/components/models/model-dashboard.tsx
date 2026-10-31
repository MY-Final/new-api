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
import {
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  KeyRound,
  ScrollText,
  Users,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { buildLogsDrilldownSearch } from '@/lib/logs-drilldown'
import { requireServerSuccess } from '@/lib/server-error-message'
import { getRollingDateRange } from '@/lib/time'
import { useAuthStore } from '@/stores/auth-store'

import { getUserQuotaDates } from '../../api'
import { buildQueryParams } from '../../lib/filters'
import { buildDashboardAnalytics } from '../../lib/operations'
import type { DashboardChartPreferences, DashboardFilters } from '../../types'
import { DateRangePresets } from '../date-range-presets'
import { ConsumptionDistributionChart } from './consumption-distribution-chart'
import { LogStatCards } from './log-stat-cards'
import { ModelCharts } from './model-charts'
import { PerformanceSuccessCard } from './performance-overview'
import { PersonalBalanceCard } from './personal-balance-card'
import { RecentUsage } from './recent-usage'

interface ModelDashboardProps {
  isAdmin: boolean
  filters: DashboardFilters
  preferences: DashboardChartPreferences
  onFilterChange: (filters: DashboardFilters) => void
  refetchInterval: number | false
}

export function ModelDashboard(props: ModelDashboardProps) {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const usageFilters = props.isAdmin
    ? props.filters
    : { ...props.filters, username: undefined }
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
  const analytics = useMemo(
    () => buildDashboardAnalytics(query.data ?? [], granularity, range),
    [query.data, granularity, range]
  )
  const hasUsage =
    analytics.summary.count > 0 ||
    analytics.summary.quota > 0 ||
    analytics.summary.tokens > 0
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
  let analysisContent: ReactNode
  if (query.isError) {
    analysisContent = (
      <ErrorState
        title={t('Failed to load statistics')}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (query.isPending || hasUsage) {
    analysisContent = (
      <div className='flex min-w-0 flex-col gap-4'>
        <ConsumptionDistributionChart
          data={analytics}
          loading={query.isPending}
          defaultChartType={props.preferences.consumptionDistributionChart}
          timeGranularity={granularity}
          requireMultipleBuckets
        />
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                type='button'
                variant='outline'
                className='group w-full justify-between'
              />
            }
          >
            {props.isAdmin ? t('Model Ranking') : t('My model usage')}
            <ChevronDown
              aria-hidden='true'
              className='transition-transform group-aria-expanded:rotate-180'
            />
          </CollapsibleTrigger>
          <CollapsibleContent className='pt-3'>
            <ModelCharts
              key={props.preferences.modelRankingMetric}
              data={analytics.models}
              loading={query.isPending}
              defaultMetric={props.preferences.modelRankingMetric}
              filters={{
                ...usageFilters,
                start_timestamp: range.start,
                end_timestamp: range.end,
              }}
              title={props.isAdmin ? undefined : t('My model usage')}
            />
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  } else {
    analysisContent = (
      <div className='bg-card overflow-hidden rounded-2xl border'>
        <div className='grid sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]'>
          <EmptyState
            icon={ChartNoAxesColumnIncreasing}
            title={t('No usage data')}
            description={t(
              'No usage logs available. Logs will appear here once API calls are made.'
            )}
            className='min-h-40 items-start rounded-none px-5 py-6 text-left [&_[data-slot=empty-content]]:items-start [&_[data-slot=empty-header]]:items-start'
            action={
              props.isAdmin ? (
                <Link
                  to='/usage-logs/$section'
                  params={{ section: 'common' }}
                  search={buildLogsDrilldownSearch({
                    ...range,
                    username: usageFilters.username,
                  })}
                  className={buttonVariants({
                    variant: 'outline',
                    size: 'sm',
                  })}
                >
                  <ScrollText aria-hidden='true' />
                  {t('Usage Logs')}
                </Link>
              ) : undefined
            }
          />
          <div
            aria-hidden='true'
            className='bg-muted/30 relative hidden border-l sm:block'
          >
            <svg
              viewBox='0 0 400 160'
              preserveAspectRatio='none'
              className='text-muted-foreground/30 size-full'
            >
              <line
                x1='40'
                x2='40'
                y1='32'
                y2='128'
                stroke='currentColor'
                vectorEffect='non-scaling-stroke'
              />
              <line
                x1='40'
                x2='376'
                y1='128'
                y2='128'
                stroke='currentColor'
                vectorEffect='non-scaling-stroke'
              />
              {[32, 64, 96].map((y) => (
                <line
                  key={y}
                  x1='40'
                  x2='48'
                  y1={y}
                  y2={y}
                  stroke='currentColor'
                  vectorEffect='non-scaling-stroke'
                />
              ))}
              {[88, 136, 184, 232, 280, 328, 376].map((x) => (
                <line
                  key={x}
                  x1={x}
                  x2={x}
                  y1='128'
                  y2='136'
                  stroke='currentColor'
                  vectorEffect='non-scaling-stroke'
                />
              ))}
            </svg>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <section
        aria-label={t('Period Summary')}
        className='bg-card overflow-hidden rounded-2xl border'
      >
        <div className='flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-4'>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <Badge
              variant='outline'
              className='border-border/70 bg-muted/50 h-7 max-w-full gap-1.5 rounded-md px-2 font-normal [overflow-wrap:anywhere] whitespace-normal'
            >
              <Users data-icon='inline-start' aria-hidden='true' />
              {props.isAdmin
                ? props.filters.username || t('All users')
                : t('My usage')}
            </Badge>
            <DateRangePresets
              range={range}
              onChange={handleRangeChange}
              variant='segmented'
            />
          </div>
          <CompactDateTimeRangePicker
            start={range.start}
            end={range.end}
            onChange={handleRangeChange}
            maxRangeDays={30}
            className='h-7 max-w-full min-w-0 text-xs sm:w-auto'
          />
        </div>
        <div className='bg-border grid min-w-0 grid-cols-2 gap-px lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]'>
          {!props.isAdmin && <PersonalBalanceCard compact />}
          <LogStatCards
            data={analytics}
            loading={query.isLoading}
            error={query.isError}
            personal={!props.isAdmin}
            compact
          />
          {props.isAdmin && (
            <PerformanceSuccessCard
              refetchInterval={props.refetchInterval}
              compact
            />
          )}
        </div>
      </section>
      {!props.isAdmin && (
        <div className='flex flex-wrap gap-2'>
          <Link
            to='/keys'
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <KeyRound aria-hidden='true' />
            {t('API Keys')}
          </Link>
        </div>
      )}
      {!props.isAdmin && (
        <RecentUsage range={range} refetchInterval={props.refetchInterval} />
      )}
      {analysisContent}
    </div>
  )
}
