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
import { Coins, Hash, Info, Layers, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DateRangePresets } from '@/features/dashboard/components/date-range-presets'
import { StatDelta } from '@/features/dashboard/components/stat-delta'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import type { UserChartsFilters } from '@/features/dashboard/types'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { UserUsageDialog } from '@/features/users/components/dialogs/user-usage-dialog'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { dateToUnixTimestamp, getRollingDateRange } from '@/lib/time'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { getAdminUserUsageRanking, type UsageStatisticsParams } from '../api'
import { UserUsageInsights } from './user-usage-insights'
import { UserUsageRanking } from './user-usage-ranking'

interface AdminUsageAnalyticsProps {
  filters: UserChartsFilters
  onFiltersChange: (filters: UserChartsFilters) => void
  refetchInterval?: number | false
}

export function AdminUsageAnalytics(props: AdminUsageAnalyticsProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfigStore((state) => state.config.currency)
  const [view, setView] = useState('ranking')
  const isPeriodView = view === 'ranking' || view === 'tokens'
  const [sortBy, setSortBy] =
    useState<NonNullable<UsageStatisticsParams['sort_by']>>('user_cost')
  const [username, setUsername] = useState('')
  const [modelName, setModelName] = useState('')
  const [channel, setChannel] = useState('')
  const [selectedUser, setSelectedUser] = useState<{
    id: number
    username: string
  }>()
  const range = props.filters.range
  const start = dateToUnixTimestamp(range.start)
  const end = dateToUnixTimestamp(range.end)
  // A changed range, filter, sort or page size starts at page one immediately,
  // including when the parent applies a date range from its filter dialog.
  const scope = JSON.stringify([
    start,
    end,
    username,
    modelName,
    channel,
    sortBy,
    props.filters.topUserLimit,
  ])
  const [pagination, setPagination] = useState({ scope, page: 1 })
  const page = pagination.scope === scope ? pagination.page : 1
  if (pagination.scope !== scope) setPagination({ scope, page: 1 })
  const queryParams = useMemo(
    () => ({
      start_timestamp: start,
      end_timestamp: end,
      p: page,
      page_size: props.filters.topUserLimit,
      sort_by: sortBy,
      username: username || undefined,
      model_name: modelName || undefined,
      channel: channel ? Number(channel) : undefined,
    }),
    [
      start,
      end,
      page,
      props.filters.topUserLimit,
      sortBy,
      username,
      modelName,
      channel,
    ]
  )
  const rankingQuery = useQuery({
    queryKey: ['usage-statistics', 'admin', queryParams],
    queryFn: async () => {
      const result = requireServerSuccess(
        await getAdminUserUsageRanking(queryParams)
      )
      if (!result.data) throw new Error(t('Failed to load usage details'))
      return result.data
    },
    enabled: isPeriodView,
    refetchInterval: props.refetchInterval,
    retry: false,
  })
  const previousParams = useMemo(
    () => ({
      ...queryParams,
      start_timestamp: start - (end - start) - 1,
      end_timestamp: start - 1,
      p: 1,
      page_size: 1,
      sort_by: 'user_cost' as const,
    }),
    [queryParams, start, end]
  )
  const previousQuery = useQuery({
    queryKey: ['usage-statistics', 'admin', 'previous', previousParams],
    queryFn: async () => {
      const result = requireServerSuccess(
        await getAdminUserUsageRanking(previousParams)
      )
      if (!result.data) throw new Error(t('Failed to load usage details'))
      return result.data
    },
    staleTime: 60_000,
    enabled: isPeriodView,
    refetchInterval: props.refetchInterval,
    retry: false,
    meta: { errorToast: false },
  })
  const activityQuery = useQuery({
    queryKey: ['usage-statistics', 'admin', 'activity'],
    queryFn: async () => {
      const today = getRollingDateRange(0)
      // The existing endpoint returns site-wide activity independently of its
      // usage filters. Query a small, unfiltered period for this separate view.
      const result = requireServerSuccess(
        await getAdminUserUsageRanking({
          start_timestamp: dateToUnixTimestamp(today.start),
          end_timestamp: dateToUnixTimestamp(today.end),
          p: 1,
          page_size: 1,
          username: undefined,
          model_name: undefined,
          channel: undefined,
        })
      )
      if (!result.data) throw new Error(t('Failed to load usage details'))
      return result.data
    },
    enabled: view === 'activity',
    refetchInterval: props.refetchInterval,
    retry: false,
  })
  const data = rankingQuery.data
  const previous = previousQuery.isError ? undefined : previousQuery.data
  const metrics = [
    {
      title: t('Users in period'),
      description: t('Users matching the selected filters'),
      definition: t(
        'Distinct users with consumption or refund records in the selected period and filters. Users with only refunds are included.'
      ),
      value: data?.total ?? 0,
      previous: previous?.total,
      icon: Users,
    },
    {
      title: t('User Cost'),
      description: t('User charges after refunds'),
      definition: t(
        'Consumption minus refunds recorded in this period, including billed cache charges. Refunds use their own record time, even when the original charge was earlier. This is not top-up income.'
      ),
      value: data?.summary.user_cost ?? 0,
      previous: previous?.summary.user_cost,
      icon: Coins,
      money: true,
    },
    {
      title: t('Consumption records'),
      description: t('Consumption logs, excluding error logs'),
      definition: t(
        'Counts consumption log entries, not unique successful API calls. Error logs are excluded. Retries count only when a consumption record is written. Task submissions and extra settlement charges can also add records.'
      ),
      value: data?.summary.request_count ?? 0,
      previous: previous?.summary.request_count,
      icon: Hash,
    },
    {
      title: t('Total Tokens'),
      description: t('Input and output tokens'),
      definition: t(
        'Input plus output tokens from consumption logs. Cache reads and writes are included in input; reasoning is included in output. Refunds change spend, not token totals.'
      ),
      value: data?.summary.total_tokens ?? 0,
      previous: previous?.summary.total_tokens,
      icon: Layers,
    },
  ]
  const handleRangeChange = (next: { start?: Date; end?: Date }) => {
    if (!next.start || !next.end) return
    const seconds = (next.end.getTime() - next.start.getTime()) / 1000
    if (seconds < 0) {
      toast.error(t('End time must be after start time'))
      return
    }
    if (seconds > 31 * 86400) {
      toast.error(t('Date range cannot exceed {{days}} days', { days: 31 }))
      return
    }
    props.onFiltersChange({
      ...props.filters,
      range: { start: next.start, end: next.end },
    })
  }
  const periodError = rankingQuery.isError ? (
    <ErrorState
      title={t('Failed to load usage details')}
      description={rankingQuery.error.message}
      onRetry={() => void rankingQuery.refetch()}
    />
  ) : undefined

  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(String(value))}
      className='min-w-0 gap-4'
    >
      <TabsList
        className='grid w-full max-w-full grid-cols-2 gap-1 group-data-horizontal/tabs:h-auto sm:flex sm:w-fit sm:flex-wrap'
        aria-label={t('User analytics views')}
      >
        <TabsTrigger
          value='ranking'
          className='whitespace-normal sm:flex-none sm:px-3 sm:whitespace-nowrap'
        >
          {t('User ranking')}
        </TabsTrigger>
        <TabsTrigger
          value='tokens'
          className='whitespace-normal sm:flex-none sm:px-3 sm:whitespace-nowrap'
        >
          {t('Token breakdown')}
        </TabsTrigger>
        <TabsTrigger
          value='activity'
          className='whitespace-normal sm:flex-none sm:px-3 sm:whitespace-nowrap'
        >
          {t('All-site activity')}
        </TabsTrigger>
        <TabsTrigger
          value='definitions'
          className='whitespace-normal sm:flex-none sm:px-3 sm:whitespace-nowrap'
        >
          {t('Metric definitions')}
        </TabsTrigger>
      </TabsList>
      {isPeriodView && (
        <>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='flex min-w-0 flex-wrap items-center gap-2'>
              <Badge variant='outline' className='max-w-full break-all'>
                {username || t('All users')}
              </Badge>
              <DateRangePresets range={range} onChange={handleRangeChange} />
            </div>
            <CompactDateTimeRangePicker
              start={range.start}
              end={range.end}
              onChange={handleRangeChange}
              maxRangeDays={31}
              className='sm:w-auto'
            />
          </div>
          <div
            className='grid grid-cols-2 gap-3 xl:grid-cols-4'
            aria-label={t('Period Summary')}
          >
            {metrics.map((metric) => (
              <section
                key={metric.title}
                aria-label={metric.title}
                className='bg-card min-w-0 rounded-xl border p-3 sm:p-4'
              >
                <StatCard
                  title={metric.title}
                  value={
                    metric.money
                      ? formatQuota(metric.value)
                      : formatCompactNumber(metric.value, locale)
                  }
                  description={metric.description}
                  descriptionClassName='line-clamp-none'
                  icon={metric.icon}
                  iconTone='info'
                  titleAction={
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant='ghost'
                            size='icon-xs'
                            aria-label={t('Metric definition: {{metric}}', {
                              metric: metric.title,
                            })}
                          />
                        }
                      >
                        <Info aria-hidden='true' />
                      </TooltipTrigger>
                      <TooltipContent className='max-w-[min(24rem,calc(100vw-2rem))] leading-relaxed'>
                        {metric.definition}
                      </TooltipContent>
                    </Tooltip>
                  }
                  loading={rankingQuery.isLoading}
                  error={rankingQuery.isError}
                  action={
                    !rankingQuery.isLoading &&
                    !rankingQuery.isError &&
                    metric.previous !== undefined ? (
                      <StatDelta
                        current={metric.value}
                        previous={metric.previous}
                      />
                    ) : undefined
                  }
                  visualization={
                    !metric.money &&
                    metric.value >= 1000 &&
                    !rankingQuery.isLoading &&
                    !rankingQuery.isError && (
                      <div className='text-muted-foreground text-xs tabular-nums'>
                        {formatNumber(metric.value, locale)}
                      </div>
                    )
                  }
                />
              </section>
            ))}
          </div>
          <div className='grid min-w-0 gap-2 sm:grid-cols-3'>
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t('Filter users')}
              aria-label={t('Filter users')}
            />
            <Input
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              placeholder={t('Filter models')}
              aria-label={t('Filter models')}
            />
            <Input
              value={channel}
              onChange={(event) =>
                setChannel(event.target.value.replaceAll(/\D/g, ''))
              }
              placeholder={t('Channel ID')}
              aria-label={t('Channel ID')}
              inputMode='numeric'
            />
          </div>
        </>
      )}
      <TabsContent value='ranking'>
        {periodError ?? (
          <UserUsageRanking
            data={data}
            loading={rankingQuery.isLoading}
            sortBy={sortBy}
            onSortChange={setSortBy}
            page={page}
            pageSize={props.filters.topUserLimit}
            onPageChange={(nextPage) =>
              setPagination({ scope, page: nextPage })
            }
            onPageSizeChange={(pageSize) =>
              props.onFiltersChange({
                ...props.filters,
                topUserLimit: pageSize,
              })
            }
            range={range}
            modelName={modelName || undefined}
            channel={queryParams.channel}
            onUserSelect={(item) =>
              setSelectedUser({ id: item.user_id, username: item.username })
            }
          />
        )}
      </TabsContent>
      <TabsContent value='tokens'>
        {periodError ?? (
          <UserUsageInsights
            view='tokens'
            data={data}
            loading={rankingQuery.isLoading}
          />
        )}
      </TabsContent>
      <TabsContent value='activity'>
        {activityQuery.isError ? (
          <ErrorState
            title={t('Failed to load usage details')}
            description={activityQuery.error.message}
            onRetry={() => void activityQuery.refetch()}
          />
        ) : (
          <UserUsageInsights
            view='activity'
            data={activityQuery.data}
            loading={activityQuery.isLoading}
          />
        )}
      </TabsContent>
      <TabsContent value='definitions'>
        <PanelWrapper
          title={t('Metric definitions')}
          className='rounded-xl shadow-none'
        >
          <dl className='grid gap-5 sm:grid-cols-2'>
            {metrics.map((metric) => (
              <div key={metric.title} className='min-w-0'>
                <dt className='mb-2 font-semibold'>{metric.title}</dt>
                <dd className='text-muted-foreground text-sm leading-relaxed'>
                  {metric.definition}
                </dd>
              </div>
            ))}
          </dl>
        </PanelWrapper>
      </TabsContent>
      {selectedUser && (
        <UserUsageDialog
          key={selectedUser.id}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedUser(undefined)
          }}
          userId={selectedUser.id}
          username={selectedUser.username}
          initialRange={range}
          usageFilters={{
            model_name: modelName || undefined,
            channel: queryParams.channel,
          }}
        />
      )}
    </Tabs>
  )
}
