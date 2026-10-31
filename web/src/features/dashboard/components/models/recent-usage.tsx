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
import { CircleAlert, FileClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LogsDrilldownLink } from '@/components/logs-drilldown-link'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { getUserLogs } from '@/features/usage-logs/api'
import { LogCostDisplay } from '@/features/usage-logs/components/log-cost-display'
import { LOG_TYPE_ENUM } from '@/features/usage-logs/constants'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import {
  parseLogOther,
  renderLogContent,
} from '@/features/usage-logs/lib/format'
import { formatTimestampToDate } from '@/lib/format'
import { buildLogsDrilldownSearch } from '@/lib/logs-drilldown'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { PanelWrapper } from '../ui/panel-wrapper'

const RECENT_ROWS = 5
const CONSUMPTION_SAMPLE = 20

interface RecentUsageProps {
  range: { start: Date; end: Date }
  refetchInterval: number | false
}

export function RecentUsage(props: RecentUsageProps) {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const start = Math.floor(props.range.start.getTime() / 1000)
  const end = Math.floor(props.range.end.getTime() / 1000)
  const query = useQuery({
    queryKey: ['dashboard-recent-usage', userId, start, end],
    queryFn: async () => {
      const params = { p: 1, start_timestamp: start, end_timestamp: end }
      const [errors, consumption] = await Promise.all([
        getUserLogs({
          ...params,
          type: LOG_TYPE_ENUM.ERROR,
          page_size: RECENT_ROWS,
        }),
        getUserLogs({
          ...params,
          type: LOG_TYPE_ENUM.CONSUME,
          page_size: CONSUMPTION_SAMPLE,
        }),
      ])
      const errorRows = (requireServerSuccess(errors).data?.items ??
        []) as UsageLog[]
      const consumeRows = (requireServerSuccess(consumption).data?.items ??
        []) as UsageLog[]
      return [...errorRows, ...consumeRows]
        .map((log) => ({ log, other: parseLogOther(log.other ?? '') }))
        .sort((a, b) => b.log.created_at - a.log.created_at)
        .slice(0, RECENT_ROWS)
    },
    enabled: userId != null,
    refetchInterval: props.refetchInterval,
    staleTime: 30_000,
    retry: false,
  })
  const title = t('Recent usage')
  const description = t(
    'Recent consumption and error logs in the selected period'
  )

  return (
    <PanelWrapper
      title={title}
      description={description}
      loading={query.isPending}
      height='h-36'
      className='rounded-xl shadow-none'
      contentClassName='p-0 sm:p-0'
      headerActions={
        <Link
          to='/usage-logs/$section'
          params={{ section: 'common' }}
          search={buildLogsDrilldownSearch(props.range)}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          {t('Usage Logs')}
        </Link>
      }
    >
      {query.isError && (
        <ErrorState
          title={t('Failed to load recent activity')}
          onRetry={() => void query.refetch()}
          className='min-h-40'
        />
      )}
      {!query.isError && Boolean(query.data?.length) && (
        <ul className='divide-y'>
          {query.data?.map(({ log, other }) => {
            const streamError =
              other?.stream_status != null &&
              other.stream_status.status !== 'ok'
            const isError = log.type === LOG_TYPE_ENUM.ERROR || streamError
            const reason = streamError
              ? other?.stream_status?.end_reason
              : (renderLogContent(other, t) ?? log.content)
            let status = t('Consume')
            if (streamError) status = t('Stream error')
            else if (isError) status = t('Error')
            return (
              <li
                key={`${log.type}-${log.id}`}
                className='flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5'
              >
                <div className='flex min-w-0 flex-1 items-start gap-3'>
                  <span className='bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg'>
                    {isError ? (
                      <CircleAlert
                        className='text-destructive size-4'
                        aria-hidden='true'
                      />
                    ) : (
                      <FileClock className='size-4' aria-hidden='true' />
                    )}
                  </span>
                  <div className='min-w-0 space-y-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='min-w-0 font-medium [overflow-wrap:anywhere]'>
                        {log.model_name || t('Unknown')}
                      </span>
                      <Badge variant={isError ? 'destructive' : 'secondary'}>
                        {status}
                      </Badge>
                    </div>
                    <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
                      <time
                        dateTime={new Date(log.created_at * 1000).toISOString()}
                      >
                        {formatTimestampToDate(log.created_at)}
                      </time>
                      {reason && (
                        <span className='line-clamp-2 min-w-0 [overflow-wrap:anywhere]'>
                          {reason}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className='ml-11 flex items-center gap-3 sm:ml-0'>
                  {typeof log.quota === 'number' && (
                    <LogCostDisplay quota={log.quota} other={other} />
                  )}
                  <LogsDrilldownLink
                    {...props.range}
                    model={log.model_name || undefined}
                    requestId={log.request_id || undefined}
                    errorOnly={log.type === LOG_TYPE_ENUM.ERROR}
                    showLabel
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {!query.isError && !query.isPending && !query.data?.length && (
        <EmptyState
          icon={FileClock}
          title={t('No recent usage in this period')}
          className='min-h-40'
          action={
            <Link
              to='/keys'
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('API Keys')}
            </Link>
          }
        />
      )}
    </PanelWrapper>
  )
}
