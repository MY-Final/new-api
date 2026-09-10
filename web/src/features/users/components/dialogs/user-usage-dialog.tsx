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
import { Loading03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { UsageOverview } from '@/features/usage-statistics/components/usage-overview'
import { UsageRequestsTable } from '@/features/usage-statistics/components/usage-requests-table'
import { dateToUnixTimestamp, getRollingDateRange } from '@/lib/time'

import { getUserUsage } from '../../api'

const MAX_USAGE_RANGE_DAYS = 31

interface UserUsageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: number
  username: string
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
    content = (
      <>
        <UsageOverview data={usageQuery.data} showAccount />
        <section className='space-y-2'>
          <h3 className='text-sm font-semibold'>{t('Request Details')}</h3>
          <UsageRequestsTable
            key={`${props.userId}-${startTimestamp}-${endTimestamp}`}
            endpoint={`/api/statistics/users/${props.userId}/requests`}
            params={{
              start_timestamp: startTimestamp,
              end_timestamp: endTimestamp,
            }}
            queryKey='admin-user-requests'
          />
        </section>
      </>
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`${t('Usage Details')} - ${props.username}`}
      contentClassName='sm:max-w-6xl'
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
