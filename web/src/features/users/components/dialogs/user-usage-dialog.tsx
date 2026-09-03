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
import { Loading03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { formatNumber, formatQuota } from '@/lib/format'
import { dateToUnixTimestamp, getRollingDateRange } from '@/lib/time'

import { getUserUsage } from '../../api'
import type { UserUsage, UserUsageAggregate } from '../../types'
import { UserUsageChart } from './user-usage-charts'

const MAX_USAGE_RANGE_DAYS = 31

interface UserUsageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: number
  username: string
}

function UsageMetric(props: { label: string; value: string }) {
  return (
    <div className='rounded-lg border px-3 py-2.5'>
      <div className='text-muted-foreground text-xs'>{props.label}</div>
      <div className='mt-1 text-base font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

function SummaryMetrics(props: { summary: UserUsageAggregate }) {
  const { t } = useTranslation()
  const metrics = [
    [t('Requests'), formatNumber(props.summary.request_count)],
    [t('Prompt Tokens'), formatNumber(props.summary.prompt_tokens)],
    [t('Completion Tokens'), formatNumber(props.summary.completion_tokens)],
    [t('Total Tokens'), formatNumber(props.summary.total_tokens)],
    [t('Consumed Quota'), formatQuota(props.summary.consumed_quota)],
    [t('Refunded Quota'), formatQuota(props.summary.refunded_quota)],
    [t('Net Quota'), formatQuota(props.summary.net_quota)],
  ]

  return (
    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
      {metrics.map(([label, value]) => (
        <UsageMetric key={label} label={label} value={value} />
      ))}
    </div>
  )
}

function ModelUsageTable(props: { data: UserUsage['models'] }) {
  const { t } = useTranslation()

  if (props.data.length === 0) {
    return (
      <div className='text-muted-foreground flex min-h-20 items-center justify-center rounded-lg border text-sm'>
        {t('No usage data')}
      </div>
    )
  }

  return (
    <div className='overflow-x-auto rounded-lg border'>
      <Table className='min-w-[900px]'>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Model')}</TableHead>
            <TableHead className='text-right'>{t('Requests')}</TableHead>
            <TableHead className='text-right'>{t('Prompt Tokens')}</TableHead>
            <TableHead className='text-right'>
              {t('Completion Tokens')}
            </TableHead>
            <TableHead className='text-right'>{t('Total Tokens')}</TableHead>
            <TableHead className='text-right'>{t('Consumed Quota')}</TableHead>
            <TableHead className='text-right'>{t('Refunded Quota')}</TableHead>
            <TableHead className='text-right'>{t('Net Quota')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.data.map((item) => (
            <TableRow key={item.model_name || '__empty_model__'}>
              <TableCell className='max-w-52 truncate font-medium'>
                {item.model_name || '-'}
              </TableCell>
              <TableCell className='text-right'>
                {formatNumber(item.request_count)}
              </TableCell>
              <TableCell className='text-right'>
                {formatNumber(item.prompt_tokens)}
              </TableCell>
              <TableCell className='text-right'>
                {formatNumber(item.completion_tokens)}
              </TableCell>
              <TableCell className='text-right'>
                {formatNumber(item.total_tokens)}
              </TableCell>
              <TableCell className='text-right'>
                {formatQuota(item.consumed_quota)}
              </TableCell>
              <TableCell className='text-right'>
                {formatQuota(item.refunded_quota)}
              </TableCell>
              <TableCell className='text-right'>
                {formatQuota(item.net_quota)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function UsageDialogContent(props: { data: UserUsage }) {
  const { t } = useTranslation()

  return (
    <div className='space-y-4'>
      <div className='text-sm'>
        <span className='font-medium'>{props.data.user.username}</span>
        {props.data.user.display_name &&
          props.data.user.display_name !== props.data.user.username && (
            <span className='text-muted-foreground ms-2'>
              {props.data.user.display_name}
            </span>
          )}
      </div>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
        <UsageMetric
          label={t('Balance')}
          value={formatQuota(props.data.user.quota)}
        />
        <UsageMetric
          label={t('Used Quota')}
          value={formatQuota(props.data.user.used_quota)}
        />
        <UsageMetric
          label={t('Request Count')}
          value={formatNumber(props.data.user.request_count)}
        />
      </div>

      <section className='space-y-2'>
        <h3 className='text-sm font-semibold'>{t('Period Summary')}</h3>
        <SummaryMetrics summary={props.data.summary} />
      </section>

      <section className='space-y-2'>
        <h3 className='text-sm font-semibold'>{t('Daily Usage')}</h3>
        <div className='grid gap-3 lg:grid-cols-2'>
          <UserUsageChart
            data={props.data.daily}
            metric='tokens'
            title={t('Token Trend')}
            color='#2563eb'
          />
          <UserUsageChart
            data={props.data.daily}
            metric='quota'
            title={t('Quota Trend')}
            color='#16a34a'
          />
        </div>
      </section>

      <section className='space-y-2'>
        <h3 className='text-sm font-semibold'>{t('Model Ranking')}</h3>
        <ModelUsageTable data={props.data.models} />
      </section>
    </div>
  )
}

export function UserUsageDialog(props: UserUsageDialogProps) {
  const { t } = useTranslation()
  const [range, setRange] = useState(() => getRollingDateRange(30))
  const startTimestamp = dateToUnixTimestamp(range.start)
  const endTimestamp = dateToUnixTimestamp(range.end)

  const usageQuery = useQuery({
    queryKey: ['users', 'usage', props.userId, startTimestamp, endTimestamp],
    enabled: props.open && props.userId > 0,
    queryFn: async () => {
      const result = await getUserUsage(
        props.userId,
        startTimestamp,
        endTimestamp
      )
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

  let content: ReactNode = null
  if (usageQuery.isLoading) {
    content = (
      <div className='text-muted-foreground flex min-h-48 items-center justify-center gap-2 text-sm'>
        <HugeiconsIcon
          icon={Loading03Icon}
          className='size-4 animate-spin'
          strokeWidth={2}
        />
        {t('Loading...')}
      </div>
    )
  } else if (usageQuery.isError) {
    content = (
      <ErrorState
        className='min-h-48'
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
    content = <UsageDialogContent data={usageQuery.data} />
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`${t('Usage Details')} - ${props.username}`}
      contentClassName='sm:max-w-5xl'
      bodyClassName='space-y-4'
    >
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <div className='text-muted-foreground text-sm'>{t('Usage Period')}</div>
        <CompactDateTimeRangePicker
          start={range.start}
          end={range.end}
          onChange={handleRangeChange}
          maxRangeDays={MAX_USAGE_RANGE_DAYS}
          className='sm:max-w-md'
        />
      </div>

      {content}
    </Dialog>
  )
}
