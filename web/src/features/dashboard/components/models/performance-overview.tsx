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
import { Gauge, HeartPulse, Timer } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { getPerfMetricsSummary } from '@/features/performance-metrics/api'
import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
  getSuccessRateLevel,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import { buildLogsDrilldownSearch } from '@/lib/logs-drilldown'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { PanelWrapper } from '../ui/panel-wrapper'
import { StatCard } from '../ui/stat-card'

interface PerformanceOverviewProps {
  refetchInterval?: number | false
}

function usePerformanceSummary(refetchInterval?: number | false) {
  return useQuery({
    queryKey: ['perf-metrics-summary', 24],
    queryFn: async () => requireServerSuccess(await getPerfMetricsSummary(24)),
    refetchInterval,
    staleTime: 60_000,
    retry: false,
  })
}

export function PerformanceSuccessCard(props: PerformanceOverviewProps) {
  const { t } = useTranslation()
  const query = usePerformanceSummary(props.refetchInterval)
  const rate = query.data?.data.summary?.success_rate ?? Number.NaN
  return (
    <section
      aria-label={t('Success rate')}
      className='bg-card min-w-0 rounded-xl border p-3 sm:p-4'
    >
      <StatCard
        title={t('Success rate')}
        value={formatUptimePct(rate)}
        description={t('All-site performance · last 24 hours')}
        descriptionClassName='line-clamp-none'
        icon={HeartPulse}
        iconTone='success'
        loading={query.isLoading}
        error={query.isError}
        visualization={
          Number.isFinite(rate) && !query.isError ? (
            <Progress
              value={Math.min(100, Math.max(0, rate))}
              aria-label={t('Success rate')}
              className='gap-0'
            />
          ) : undefined
        }
      />
    </section>
  )
}

export function PerformanceOverview(props: PerformanceOverviewProps) {
  const { t } = useTranslation()
  const query = usePerformanceSummary(props.refetchInterval)
  const summary = query.data?.data.summary
  const models = useMemo(
    () =>
      [...(query.data?.data.models ?? [])]
        .sort((a, b) => {
          const rateA = Number.isFinite(a.success_rate)
            ? a.success_rate
            : Infinity
          const rateB = Number.isFinite(b.success_rate)
            ? b.success_rate
            : Infinity
          return rateA - rateB || a.model_name.localeCompare(b.model_name)
        })
        .slice(0, 5),
    [query.data]
  )
  const windowEnd = query.data?.data.window_end ?? Math.floor(Date.now() / 1000)
  const windowStart = query.data?.data.window_start ?? windowEnd - 86400

  return (
    <PanelWrapper
      title={t('Models to watch')}
      description={t('Lowest success rates · all site · last 24 hours')}
      loading={query.isLoading}
      empty={!query.isError && models.length === 0}
      emptyMessage={t('No performance data available')}
      height='h-64'
      className='h-full rounded-xl shadow-none'
    >
      {query.isError ? (
        <ErrorState
          title={t('Failed to load performance data')}
          onRetry={() => void query.refetch()}
          className='min-h-64'
        />
      ) : (
        <div className='flex flex-col gap-3'>
          {models.map((model) => {
            const level = getSuccessRateLevel(model.success_rate)
            return (
              <div
                key={model.model_name}
                className={cn(
                  'flex min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-2',
                  (level === 'warning' || level === 'critical') &&
                    'bg-warning/10'
                )}
              >
                <Link
                  className={cn(
                    buttonVariants({ variant: 'link' }),
                    'h-auto min-w-0 shrink justify-start p-0'
                  )}
                  aria-label={t('View failed requests for {{model}}', {
                    model: model.model_name,
                  })}
                  to='/usage-logs/$section'
                  params={{ section: 'common' }}
                  search={buildLogsDrilldownSearch({
                    start: new Date(windowStart * 1000),
                    end: new Date(windowEnd * 1000),
                    model: model.model_name,
                    errorOnly: true,
                  })}
                >
                  <span
                    className='truncate font-mono text-xs'
                    title={model.model_name}
                  >
                    {model.model_name}
                  </span>
                </Link>
                <span
                  className={cn(
                    'shrink-0 font-mono text-sm font-semibold tabular-nums',
                    getSuccessRateTextClass(model.success_rate)
                  )}
                >
                  {formatUptimePct(model.success_rate)}
                </span>
              </div>
            )
          })}
          <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs'>
            <span className='inline-flex items-center gap-1.5'>
              <HeartPulse className='size-3.5' aria-hidden='true' />
              {t('Success rate')}
              <strong className='text-foreground font-mono font-medium'>
                {formatUptimePct(summary?.success_rate ?? Number.NaN)}
              </strong>
            </span>
            <span className='inline-flex items-center gap-1.5'>
              <Timer className='size-3.5' aria-hidden='true' />
              {t('Average latency')}
              <strong className='text-foreground font-mono font-medium'>
                {formatLatency(summary?.avg_latency_ms ?? Number.NaN)}
              </strong>
            </span>
            <span className='inline-flex items-center gap-1.5'>
              <Gauge className='size-3.5' aria-hidden='true' />
              {t('Throughput')}
              <strong className='text-foreground font-mono font-medium'>
                {formatThroughput(summary?.avg_tps ?? Number.NaN)}
              </strong>
            </span>
          </div>
        </div>
      )}
    </PanelWrapper>
  )
}
