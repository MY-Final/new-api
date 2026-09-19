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
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LogsDrilldownLink } from '@/components/logs-drilldown-link'
import { Skeleton } from '@/components/ui/skeleton'
import { getDefaultDays } from '@/features/dashboard/lib'
import type { DashboardFilters } from '@/features/dashboard/types'
import { useStatus } from '@/hooks/use-status'
import { createServerError } from '@/lib/server-error-message'
import { computeTimeRange } from '@/lib/time'

import { getLogAnalysis } from '../api'
import { DEFAULT_REALTIME_WINDOW_MINUTES } from '../constants'
import type { LogAnalysisRealtime } from '../types'
import { ChannelHealthTable } from './channel-health-table'
import { ErrorBreakdown } from './error-breakdown'
import { RealtimeStrip } from './realtime-strip'

interface ReliabilityPanelProps {
  filters?: DashboardFilters
  refetchInterval?: number | false
}

const EMPTY_REALTIME: LogAnalysisRealtime = {
  minutes: DEFAULT_REALTIME_WINDOW_MINUTES,
  consume_count: 0,
  error_count: 0,
  quota: 0,
  tokens: 0,
  active_users: 0,
  success_rate: 0,
  rpm: 0,
  tpm: 0,
}

export function ReliabilityPanel(props: ReliabilityPanelProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const [windowMinutes, setWindowMinutes] = useState(
    DEFAULT_REALTIME_WINDOW_MINUTES
  )

  const timeRange = computeTimeRange(
    getDefaultDays(props.filters?.time_granularity),
    props.filters?.start_timestamp,
    props.filters?.end_timestamp
  )
  const start = new Date(timeRange.start_timestamp * 1000)
  const end = new Date(timeRange.end_timestamp * 1000)

  const analysisQuery = useQuery({
    queryKey: [
      'log-analysis',
      timeRange.start_timestamp,
      timeRange.end_timestamp,
      props.filters?.username ?? '',
      windowMinutes,
    ],
    queryFn: async () => {
      const result = await getLogAnalysis({
        start_timestamp: timeRange.start_timestamp,
        end_timestamp: timeRange.end_timestamp,
        username: props.filters?.username || undefined,
        top_limit: 10,
        realtime_minutes: windowMinutes,
      })
      if (!result.success || !result.data) {
        throw createServerError(result, t('Failed to load log analysis'))
      }
      return result.data
    },
    refetchInterval: props.refetchInterval,
    staleTime: 15_000,
    retry: false,
  })

  const data = analysisQuery.data
  const errorLogsDisabled = status?.error_log_enabled === false

  let analysisContent: ReactNode
  if (analysisQuery.isError) {
    analysisContent = (
      <ErrorState
        className='min-h-40'
        title={t('Failed to load log analysis')}
        description={
          analysisQuery.error instanceof Error
            ? analysisQuery.error.message
            : undefined
        }
        onRetry={() => analysisQuery.refetch()}
      />
    )
  } else if (analysisQuery.isLoading || !data) {
    analysisContent = (
      <div className='space-y-2 p-4 sm:p-5'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-4 w-2/3' />
        <Skeleton className='h-4 w-1/2' />
      </div>
    )
  } else {
    analysisContent = <ErrorBreakdown data={data} start={start} end={end} />
  }

  return (
    <div className='space-y-3 sm:space-y-4'>
      <RealtimeStrip
        realtime={data?.realtime ?? EMPTY_REALTIME}
        loading={analysisQuery.isLoading}
        windowMinutes={windowMinutes}
        onWindowMinutesChange={setWindowMinutes}
      />

      <div className='overflow-hidden rounded-lg border'>
        <div className='flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 sm:px-5'>
          <div>
            <h3 className='text-sm font-semibold'>{t('Error Analysis')}</h3>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              {t('Failure reasons, trends, and the busiest failing callers.')}
            </p>
          </div>
          <LogsDrilldownLink start={start} end={end} errorOnly showLabel />
        </div>

        {errorLogsDisabled ? (
          <p className='border-b px-4 py-2.5 text-xs text-amber-600 sm:px-5 dark:text-amber-400'>
            {t(
              'Error logging is disabled. Set ERROR_LOG_ENABLED=true to record failed requests.'
            )}
          </p>
        ) : null}

        {analysisContent}
      </div>

      {!analysisQuery.isError ? (
        <ChannelHealthTable
          channels={data?.channels ?? []}
          start={start}
          end={end}
          loading={analysisQuery.isLoading}
        />
      ) : null}
    </div>
  )
}
