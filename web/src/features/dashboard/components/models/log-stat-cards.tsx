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
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserQuotaDates } from '@/features/dashboard/api'
import { StatDelta } from '@/features/dashboard/components/stat-delta'
import { useModelStatCardsConfig } from '@/features/dashboard/hooks/use-dashboard-config'
import {
  buildQueryParams,
  calculateDashboardStats,
  getDefaultDays,
} from '@/features/dashboard/lib'
import type {
  DashboardFilters,
  QuotaDataItem,
} from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { computeTimeRange } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

interface LogStatCardsProps {
  filters?: DashboardFilters
  onDataUpdate?: (data: QuotaDataItem[], loading: boolean) => void
  refetchInterval?: number | false
}

const MAX_INLINE_STAT_CHARS = 9

function formatStatNumber(value: number, locale: Intl.LocalesArgument) {
  const fullValue = formatNumber(value, locale)
  const displayValue =
    fullValue.length > MAX_INLINE_STAT_CHARS
      ? formatCompactNumber(value, locale)
      : fullValue

  return {
    displayValue,
    fullValue,
  }
}

export function LogStatCards(props: LogStatCardsProps) {
  const { i18n } = useTranslation()
  const statCardsConfig = useModelStatCardsConfig()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = !!(user?.role && user.role >= 10)

  const { filters, onDataUpdate } = props
  const timeRange = computeTimeRange(
    getDefaultDays(filters?.time_granularity),
    filters?.start_timestamp,
    filters?.end_timestamp
  )
  const timeRangeMinutes =
    (timeRange.end_timestamp - timeRange.start_timestamp) / 60
  const timeRangeSeconds = timeRange.end_timestamp - timeRange.start_timestamp
  // Same-length window immediately before the selected one, used for the
  // period-over-period deltas shown under each card value.
  const previousRange = {
    start_timestamp: timeRange.start_timestamp - timeRangeSeconds,
    end_timestamp: timeRange.start_timestamp - 1,
  }

  const quotaQuery = useQuery({
    queryKey: [
      'dashboard-quota-dates',
      timeRange.start_timestamp,
      timeRange.end_timestamp,
      filters?.username ?? '',
      isAdmin,
    ],
    queryFn: async () => {
      const response = await getUserQuotaDates(
        buildQueryParams(timeRange, filters),
        isAdmin
      )
      return response?.data || []
    },
    refetchInterval: props.refetchInterval,
    staleTime: 30_000,
    retry: false,
    placeholderData: (previous) => previous,
  })

  const previousQuery = useQuery({
    queryKey: [
      'dashboard-quota-dates-previous',
      previousRange.start_timestamp,
      previousRange.end_timestamp,
      filters?.username ?? '',
      isAdmin,
    ],
    queryFn: async () => {
      const response = await getUserQuotaDates(
        buildQueryParams(previousRange, filters),
        isAdmin
      )
      return response?.data || []
    },
    staleTime: 60_000,
    retry: false,
  })

  useEffect(() => {
    onDataUpdate?.(quotaQuery.data ?? [], quotaQuery.isFetching)
  }, [onDataUpdate, quotaQuery.data, quotaQuery.isFetching])

  const loading = quotaQuery.isLoading
  const error = quotaQuery.isError
  const stats = quotaQuery.data
    ? calculateDashboardStats(quotaQuery.data)
    : null
  const previousStats = previousQuery.data
    ? calculateDashboardStats(previousQuery.data)
    : null

  const adaptedStats = {
    rpm: stats?.totalCount ?? 0,
    quota: stats?.totalQuota ?? 0,
    tpm: stats?.totalTokens ?? 0,
  }
  const adaptedPreviousStats = {
    rpm: previousStats?.totalCount ?? 0,
    quota: previousStats?.totalQuota ?? 0,
    tpm: previousStats?.totalTokens ?? 0,
  }

  const items = statCardsConfig.map((config) => {
    const rawValue = config.getValue(adaptedStats, timeRangeMinutes)
    const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
    const formatted =
      config.key === 'quota'
        ? {
            displayValue: formatQuota(rawValue),
            fullValue: formatQuota(rawValue),
          }
        : formatStatNumber(rawValue, locale)
    const previousValue = previousStats
      ? config.getValue(adaptedPreviousStats, timeRangeMinutes)
      : undefined

    return {
      title: config.title,
      value: formatted.displayValue,
      fullValue: formatted.fullValue,
      desc: config.description,
      icon: config.icon,
      iconTone: config.iconTone,
      delta:
        previousValue != null ? (
          <StatDelta current={rawValue} previous={previousValue} />
        ) : null,
    }
  })

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='divide-border/60 grid min-w-0 grid-cols-2 divide-x sm:grid-cols-3 lg:grid-cols-5'>
        {items.map((it, idx) => {
          const Icon = it.icon
          let valueContent
          if (loading) {
            valueContent = (
              <div className='mt-1 flex flex-col gap-1 sm:mt-2 sm:gap-1.5'>
                <Skeleton className='h-5 w-16 sm:h-7 sm:w-20' />
                <Skeleton className='hidden h-3.5 w-28 md:block' />
              </div>
            )
          } else if (error) {
            valueContent = (
              <>
                <div className='text-muted-foreground mt-1 font-mono text-base leading-tight font-bold tracking-tight tabular-nums sm:mt-2 sm:text-2xl sm:leading-normal'>
                  --
                </div>
                <div className='text-muted-foreground/40 mt-1 hidden text-xs md:block'>
                  {it.desc}
                </div>
              </>
            )
          } else {
            valueContent = (
              <>
                <div className='mt-1 flex min-w-0 items-baseline gap-1.5 sm:mt-2'>
                  <div
                    className='text-foreground max-w-full truncate font-mono text-base leading-tight font-bold tracking-tight tabular-nums sm:text-2xl sm:leading-normal'
                    title={it.fullValue}
                  >
                    {it.value}
                  </div>
                  {it.delta}
                </div>
                <div className='text-muted-foreground/60 mt-1 hidden text-xs md:block'>
                  {it.desc}
                </div>
              </>
            )
          }

          return (
            <div
              key={it.title}
              className={cn(
                'min-w-0 px-2.5 py-1.5 sm:px-5 sm:py-4',
                idx === items.length - 1 &&
                  items.length % 2 !== 0 &&
                  'col-span-2 sm:col-span-1'
              )}
            >
              <div className='flex min-w-0 items-center gap-1.5 sm:gap-2'>
                <IconBadge
                  tone={it.iconTone}
                  size='stat'
                  className='size-4 rounded-sm sm:size-7 sm:rounded-md [&>svg]:size-2.5 sm:[&>svg]:size-3.5'
                >
                  <Icon />
                </IconBadge>
                <div className='text-muted-foreground truncate text-[11px] leading-4 font-medium tracking-wide uppercase sm:text-xs sm:tracking-wider'>
                  {it.title}
                </div>
              </div>

              {valueContent}
            </div>
          )
        })}
      </div>
    </div>
  )
}
