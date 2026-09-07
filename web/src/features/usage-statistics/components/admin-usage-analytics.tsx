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
import { Activity, BarChart3, Coins, Hash, Users } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableServerPagination } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { UserChartsFilters } from '@/features/dashboard/types'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { UserUsageDialog } from '@/features/users/components/dialogs/user-usage-dialog'
import { formatNumber, formatQuota } from '@/lib/format'
import { dateToUnixTimestamp, getRollingDateRange } from '@/lib/time'

import { getAdminUserUsageRanking } from '../api'

const RANGE_OPTIONS = [
  { label: 'Today', days: 0 },
  { label: '7 Days', days: 7 },
  { label: '14 Days', days: 14 },
  { label: '29 Days', days: 29 },
] as const

type SortBy = 'user_cost' | 'total_tokens' | 'request_count'

interface AdminUsageAnalyticsProps {
  filters: UserChartsFilters
  onFiltersChange: (filters: UserChartsFilters) => void
}

function StatCard(props: {
  label: string
  value: string
  icon: typeof Users
  tone: IconBadgeTone
}) {
  const Icon = props.icon
  return (
    <div className='min-w-0 rounded-lg border px-3 py-3'>
      <div className='flex items-center gap-2'>
        <IconBadge tone={props.tone} size='sm'>
          <Icon />
        </IconBadge>
        <span className='text-muted-foreground truncate text-xs'>
          {props.label}
        </span>
      </div>
      <div className='mt-2 font-mono text-xl font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

export function AdminUsageAnalytics(props: AdminUsageAnalyticsProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState<SortBy>('user_cost')
  const [username, setUsername] = useState('')
  const [modelName, setModelName] = useState('')
  const [channel, setChannel] = useState('')
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date }>()
  const [selectedUser, setSelectedUser] = useState<{
    id: number
    username: string
  }>()

  const range = useMemo(() => {
    if (customRange) return customRange
    return getRollingDateRange(props.filters.selectedRange)
  }, [customRange, props.filters.selectedRange])
  const queryParams = useMemo(() => {
    const params = {
      start_timestamp: dateToUnixTimestamp(range.start),
      end_timestamp: dateToUnixTimestamp(range.end),
      p: page,
      page_size: props.filters.topUserLimit,
      sort_by: sortBy,
      username: username || undefined,
      model_name: modelName || undefined,
      channel: channel ? Number(channel) : undefined,
    }
    return params
  }, [
    channel,
    modelName,
    page,
    props.filters.topUserLimit,
    range,
    sortBy,
    username,
  ])
  const rankingQuery = useQuery({
    queryKey: ['usage-statistics', 'admin', queryParams],
    queryFn: async () => {
      const result = await getAdminUserUsageRanking(queryParams)
      if (!result.success || !result.data) throw new Error(result.message)
      return result.data
    },
    placeholderData: (previous) => previous,
  })
  const data = rankingQuery.data
  let tableBody: ReactNode
  if (rankingQuery.isLoading && !data) {
    tableBody = (
      <TableRow>
        <TableCell
          colSpan={9}
          className='text-muted-foreground h-20 text-center'
        >
          {t('Loading...')}
        </TableCell>
      </TableRow>
    )
  } else if (data?.items.length) {
    tableBody = data.items.map((item) => (
      <TableRow key={item.user_id}>
        <TableCell>
          <button
            type='button'
            className='text-primary max-w-40 truncate font-medium hover:underline'
            onClick={() =>
              setSelectedUser({
                id: item.user_id,
                username: item.username,
              })
            }
          >
            {item.username || `#${item.user_id}`}
          </button>
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.request_count)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.input_tokens)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.output_tokens)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.cache_read_tokens)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.cache_write_tokens)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.reasoning_tokens)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.total_tokens)}
        </TableCell>
        <TableCell className='text-right font-medium tabular-nums'>
          {formatQuota(item.user_cost)}
        </TableCell>
      </TableRow>
    ))
  } else {
    tableBody = (
      <TableRow>
        <TableCell
          colSpan={9}
          className='text-muted-foreground h-20 text-center'
        >
          {t('No usage data')}
        </TableCell>
      </TableRow>
    )
  }

  const handlePresetChange = (value: string) => {
    setCustomRange(undefined)
    setPage(1)
    props.onFiltersChange({ ...props.filters, selectedRange: Number(value) })
  }
  const handleCustomRangeChange = (next: { start?: Date; end?: Date }) => {
    if (!next.start || !next.end) return
    setCustomRange({ start: next.start, end: next.end })
    setPage(1)
  }

  return (
    <div className='space-y-3 sm:space-y-4'>
      <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
        <Tabs
          value={customRange ? undefined : String(props.filters.selectedRange)}
          onValueChange={handlePresetChange}
        >
          <TabsList className='max-w-full overflow-x-auto'>
            {RANGE_OPTIONS.map((option) => (
              <TabsTrigger key={option.days} value={String(option.days)}>
                {t(option.label)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <CompactDateTimeRangePicker
          start={customRange?.start}
          end={customRange?.end}
          onChange={handleCustomRangeChange}
          maxRangeDays={31}
          className='lg:w-80'
        />
      </div>

      <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-5'>
        <StatCard
          label={t('DAU')}
          value={formatNumber(data?.activity.dau ?? 0)}
          icon={Users}
          tone='info'
        />
        <StatCard
          label={t('WAU')}
          value={formatNumber(data?.activity.wau ?? 0)}
          icon={Activity}
          tone='success'
        />
        <StatCard
          label={t('MAU')}
          value={formatNumber(data?.activity.mau ?? 0)}
          icon={BarChart3}
          tone='warning'
        />
        <StatCard
          label={t('Requests')}
          value={formatNumber(data?.summary.request_count ?? 0)}
          icon={Hash}
          tone='chart-4'
        />
        <StatCard
          label={t('Input Tokens')}
          value={formatNumber(data?.summary.input_tokens ?? 0)}
          icon={Hash}
          tone='chart-2'
        />
        <StatCard
          label={t('Output Tokens')}
          value={formatNumber(data?.summary.output_tokens ?? 0)}
          icon={Hash}
          tone='chart-3'
        />
        <StatCard
          label={t('Cache Tokens')}
          value={formatNumber(
            (data?.summary.cache_read_tokens ?? 0) +
              (data?.summary.cache_write_tokens ?? 0)
          )}
          icon={Hash}
          tone='chart-4'
        />
        <StatCard
          label={t('Total Tokens')}
          value={formatNumber(data?.summary.total_tokens ?? 0)}
          icon={Hash}
          tone='chart-5'
        />
        <StatCard
          label={t('User Cost')}
          value={formatQuota(data?.summary.user_cost ?? 0)}
          icon={Coins}
          tone='chart-5'
        />
      </div>

      <div className='rounded-lg border'>
        <div className='flex flex-col gap-3 border-b px-3 py-3 sm:px-5'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div>
              <h2 className='text-sm font-semibold'>
                {t('User Usage Ranking')}
              </h2>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                {t('Successful API calls only')}
              </p>
            </div>
            <Tabs
              value={sortBy}
              onValueChange={(value) => {
                setSortBy(value as SortBy)
                setPage(1)
              }}
            >
              <TabsList>
                <TabsTrigger value='user_cost'>{t('Cost')}</TabsTrigger>
                <TabsTrigger value='total_tokens'>{t('Tokens')}</TabsTrigger>
                <TabsTrigger value='request_count'>{t('Requests')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className='grid gap-2 sm:grid-cols-3'>
            <Input
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                setPage(1)
              }}
              placeholder={t('Filter users')}
              aria-label={t('Filter users')}
            />
            <Input
              value={modelName}
              onChange={(event) => {
                setModelName(event.target.value)
                setPage(1)
              }}
              placeholder={t('Filter models')}
              aria-label={t('Filter models')}
            />
            <Input
              value={channel}
              onChange={(event) => {
                setChannel(event.target.value.replaceAll(/\D/g, ''))
                setPage(1)
              }}
              placeholder={t('Channel ID')}
              aria-label={t('Channel ID')}
              inputMode='numeric'
            />
          </div>
        </div>
        {rankingQuery.isError ? (
          <ErrorState
            className='min-h-40'
            title={t('Failed to load usage details')}
            description={
              rankingQuery.error instanceof Error
                ? rankingQuery.error.message
                : undefined
            }
            onRetry={() => rankingQuery.refetch()}
          />
        ) : (
          <>
            <div className='overflow-x-auto'>
              <Table className='min-w-[980px]'>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('User')}</TableHead>
                    <TableHead className='text-right'>
                      {t('Requests')}
                    </TableHead>
                    <TableHead className='text-right'>
                      {t('Input Tokens')}
                    </TableHead>
                    <TableHead className='text-right'>
                      {t('Output Tokens')}
                    </TableHead>
                    <TableHead className='text-right'>
                      {t('Cache Read')}
                    </TableHead>
                    <TableHead className='text-right'>
                      {t('Cache Write')}
                    </TableHead>
                    <TableHead className='text-right'>
                      {t('Reasoning')}
                    </TableHead>
                    <TableHead className='text-right'>
                      {t('Total Tokens')}
                    </TableHead>
                    <TableHead className='text-right'>
                      {t('User Cost')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{tableBody}</TableBody>
              </Table>
            </div>
            <div className='border-t px-3 py-2 sm:px-5'>
              <DataTableServerPagination
                page={page}
                pageSize={props.filters.topUserLimit}
                total={data?.total ?? 0}
                onPageChange={setPage}
                onPageSizeChange={(pageSize) => {
                  setPage(1)
                  props.onFiltersChange({
                    ...props.filters,
                    topUserLimit: pageSize,
                  })
                }}
              />
            </div>
          </>
        )}
      </div>

      {selectedUser && (
        <UserUsageDialog
          open
          onOpenChange={(open) => {
            if (!open) setSelectedUser(undefined)
          }}
          userId={selectedUser.id}
          username={selectedUser.username}
        />
      )}
    </div>
  )
}
