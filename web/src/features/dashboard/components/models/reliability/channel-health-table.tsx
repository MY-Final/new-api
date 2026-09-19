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
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CHANNEL_STATUS,
  CHANNEL_STATUS_LABELS,
} from '@/features/channels/constants'
import { LogsDrilldownLink } from '@/features/dashboard/components/logs-drilldown-link'
import type { LogAnalysisChannelHealth } from '@/features/dashboard/types'
import {
  formatLatency,
  formatUptimePct,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import { formatNumber, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ChannelHealthTableProps {
  channels: LogAnalysisChannelHealth[]
  start: Date
  end: Date
  loading: boolean
}

function channelStatusMeta(status: number): {
  label: string
  variant: StatusVariant
} {
  switch (status) {
    case CHANNEL_STATUS.ENABLED:
      return {
        label: CHANNEL_STATUS_LABELS[CHANNEL_STATUS.ENABLED],
        variant: 'success',
      }
    case CHANNEL_STATUS.MANUAL_DISABLED:
      return {
        label: CHANNEL_STATUS_LABELS[CHANNEL_STATUS.MANUAL_DISABLED],
        variant: 'danger',
      }
    case CHANNEL_STATUS.AUTO_DISABLED:
      return {
        label: CHANNEL_STATUS_LABELS[CHANNEL_STATUS.AUTO_DISABLED],
        variant: 'warning',
      }
    default:
      return {
        label: CHANNEL_STATUS_LABELS[CHANNEL_STATUS.UNKNOWN],
        variant: 'neutral',
      }
  }
}

export function ChannelHealthTable(props: ChannelHealthTableProps) {
  const { t } = useTranslation()

  if (props.loading) {
    return (
      <div className='overflow-hidden rounded-lg border'>
        <div className='border-b px-4 py-3 sm:px-5'>
          <Skeleton className='h-4 w-32' />
        </div>
        <div className='space-y-2 p-4 sm:p-5'>
          {['a', 'b', 'c'].map((key) => (
            <Skeleton key={key} className='h-6 w-full' />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='border-b px-4 py-3 sm:px-5'>
        <h3 className='text-sm font-semibold'>{t('Channel health')}</h3>
        <p className='text-muted-foreground mt-0.5 text-xs'>
          {t('Ranked by traffic in the selected period')}
        </p>
      </div>
      {props.channels.length === 0 ? (
        <p className='text-muted-foreground px-4 py-6 text-center text-xs sm:px-5'>
          {t('No channel traffic in this period')}
        </p>
      ) : (
        <div className='max-h-80 overflow-auto'>
          <Table className='min-w-[900px]'>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Channel')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead className='text-right'>{t('Requests')}</TableHead>
                <TableHead className='text-right'>{t('Errors')}</TableHead>
                <TableHead className='text-right'>
                  {t('Success rate')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('Average latency')}
                </TableHead>
                <TableHead className='text-right'>{t('P95')}</TableHead>
                <TableHead className='text-right'>
                  {t('Auto Disabled')}
                </TableHead>
                <TableHead className='w-12' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.channels.map((channel) => {
                const meta = channelStatusMeta(channel.status)
                const statusDetail = channel.status_reason
                  ? `${channel.status_reason}${
                      channel.status_time > 0
                        ? ` · ${formatTimestamp(channel.status_time)}`
                        : ''
                    }`
                  : ''
                const percentileTitle = t(
                  'P50 {{p50}} · P95 {{p95}} · P99 {{p99}} · Max {{max}}',
                  {
                    p50: formatLatency(channel.p50_seconds * 1000),
                    p95: formatLatency(channel.p95_seconds * 1000),
                    p99: formatLatency(channel.p99_seconds * 1000),
                    max: formatLatency(channel.max_latency_seconds * 1000),
                  }
                )

                return (
                  <TableRow key={channel.channel_id}>
                    <TableCell className='max-w-50'>
                      <div className='truncate font-medium'>
                        {channel.channel_name || `#${channel.channel_id}`}
                      </div>
                      <div className='text-muted-foreground font-mono text-[11px]'>
                        #{channel.channel_id}
                      </div>
                    </TableCell>
                    <TableCell className='max-w-45'>
                      <StatusBadge
                        variant={meta.variant}
                        label={t(meta.label)}
                        copyable={false}
                      />
                      {statusDetail ? (
                        <p
                          className='text-muted-foreground mt-0.5 truncate text-[11px]'
                          title={statusDetail}
                        >
                          {statusDetail}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatNumber(channel.consume_count)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatNumber(channel.error_count)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono tabular-nums',
                        getSuccessRateTextClass(channel.success_rate * 100)
                      )}
                    >
                      {formatUptimePct(channel.success_rate * 100)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatLatency(channel.avg_latency_seconds * 1000)}
                    </TableCell>
                    <TableCell
                      className='text-right tabular-nums'
                      title={percentileTitle}
                    >
                      {formatLatency(channel.p95_seconds * 1000)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        channel.auto_disabled_count > 0 &&
                          'text-amber-600 dark:text-amber-400'
                      )}
                    >
                      {channel.auto_disabled_count > 0
                        ? formatNumber(channel.auto_disabled_count)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <LogsDrilldownLink
                        start={props.start}
                        end={props.end}
                        channel={channel.channel_id}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
