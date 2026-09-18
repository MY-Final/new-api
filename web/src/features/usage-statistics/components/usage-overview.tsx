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
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Brain,
  CalendarDays,
  Coins,
  Database,
  Hash,
  Sigma,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber, formatQuota } from '@/lib/format'

import { isRangeCoveringToday, type UsageDateRange } from '../lib/usage-range'
import type { UserUsage, UserUsageAggregate } from '../types'
import { UsageChart } from './usage-chart'

interface UsageMetricProps {
  label: string
  value: string
  icon?: LucideIcon
  tone?: IconBadgeTone
}

export function UsageMetric(props: UsageMetricProps) {
  const Icon = props.icon
  return (
    <div className='min-w-0 rounded-lg border px-3 py-2.5'>
      <div className='flex min-w-0 items-center gap-2'>
        {Icon && (
          <IconBadge tone={props.tone ?? 'neutral'} size='sm'>
            <Icon />
          </IconBadge>
        )}
        <span className='text-muted-foreground truncate text-xs font-medium tracking-wide uppercase'>
          {props.label}
        </span>
      </div>
      <div
        className='text-foreground mt-1.5 truncate font-mono text-lg font-semibold tabular-nums'
        title={props.value}
      >
        {props.value}
      </div>
    </div>
  )
}

/**
 * Compact one-line summary of the current day, matching the analytics cards
 * on the dashboard without repeating a full card grid.
 */
export function TodayUsageStrip(props: { summary?: UserUsageAggregate }) {
  const { t } = useTranslation()
  const summary = props.summary
  const metrics = [
    [t('Requests'), formatNumber(summary?.request_count ?? 0)],
    [t('Input Tokens'), formatNumber(summary?.input_tokens ?? 0)],
    [t('Output Tokens'), formatNumber(summary?.output_tokens ?? 0)],
    [
      t('Cache Tokens'),
      formatNumber(
        (summary?.cache_read_tokens ?? 0) + (summary?.cache_write_tokens ?? 0)
      ),
    ],
    [t('Total Tokens'), formatNumber(summary?.total_tokens ?? 0)],
    [t('User Cost'), formatQuota(summary?.user_cost ?? 0)],
  ]

  return (
    <section className='bg-muted/25 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border px-3 py-2'>
      <div className='flex items-center gap-1.5 text-sm font-semibold'>
        <CalendarDays
          className='text-muted-foreground size-4'
          aria-hidden='true'
        />
        {t('Today')}
      </div>
      {metrics.map(([label, value]) => (
        <div key={label} className='flex items-baseline gap-1.5'>
          <span className='text-muted-foreground text-xs'>{label}</span>
          <span className='font-mono text-sm font-semibold tabular-nums'>
            {value}
          </span>
        </div>
      ))}
    </section>
  )
}

export function SummaryMetrics(props: { summary: UserUsageAggregate }) {
  const { t } = useTranslation()
  const metrics: UsageMetricProps[] = [
    {
      label: t('Requests'),
      value: formatNumber(props.summary.request_count),
      icon: Hash,
      tone: 'info',
    },
    {
      label: t('Input Tokens'),
      value: formatNumber(props.summary.input_tokens),
      icon: ArrowDownToLine,
      tone: 'chart-2',
    },
    {
      label: t('Output Tokens'),
      value: formatNumber(props.summary.output_tokens),
      icon: ArrowUpFromLine,
      tone: 'chart-3',
    },
    {
      label: t('Cache Read'),
      value: formatNumber(props.summary.cache_read_tokens),
      icon: Database,
      tone: 'chart-4',
    },
    {
      label: t('Cache Write'),
      value: formatNumber(props.summary.cache_write_tokens),
      icon: Database,
      tone: 'chart-5',
    },
    {
      label: t('Reasoning'),
      value: formatNumber(props.summary.reasoning_tokens),
      icon: Brain,
      tone: 'chart-4',
    },
    {
      label: t('Total Tokens'),
      value: formatNumber(props.summary.total_tokens),
      icon: Sigma,
      tone: 'chart-5',
    },
    {
      label: t('User Cost'),
      value: formatQuota(props.summary.user_cost),
      icon: Coins,
      tone: 'warning',
    },
  ]

  return (
    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
      {metrics.map((metric) => (
        <UsageMetric
          key={metric.label}
          label={metric.label}
          value={metric.value}
          icon={metric.icon}
          tone={metric.tone}
        />
      ))}
    </div>
  )
}

export function ModelUsageTable(props: { data: UserUsage['models'] }) {
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
      <Table className='min-w-[1120px]'>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Model')}</TableHead>
            <TableHead className='text-right'>{t('Requests')}</TableHead>
            <TableHead className='text-right'>{t('Input Tokens')}</TableHead>
            <TableHead className='text-right'>{t('Output Tokens')}</TableHead>
            <TableHead className='text-right'>{t('Cache Read')}</TableHead>
            <TableHead className='text-right'>{t('Cache Write')}</TableHead>
            <TableHead className='text-right'>{t('Reasoning')}</TableHead>
            <TableHead className='text-right'>{t('Total Tokens')}</TableHead>
            <TableHead className='text-right'>{t('User Cost')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.data.map((item) => (
            <TableRow key={item.model_name || '__empty_model__'}>
              <TableCell className='max-w-52 truncate font-medium'>
                {item.model_name || '-'}
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
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

interface UsageOverviewProps {
  data: UserUsage
  showAccount?: boolean
  /**
   * Selected statistics window, used to keep the trend charts continuous
   * across days without usage.
   */
  range?: UsageDateRange
}

export function UsageOverview(props: UsageOverviewProps) {
  const { t } = useTranslation()
  const summaryTitle =
    props.range && isRangeCoveringToday(props.range)
      ? t('Today')
      : t('Period Summary')

  return (
    <div className='space-y-4'>
      {props.showAccount && (
        <>
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
              icon={Wallet}
              tone='success'
            />
            <UsageMetric
              label={t('Used Quota')}
              value={formatQuota(props.data.user.used_quota)}
              icon={TrendingUp}
              tone='warning'
            />
            <UsageMetric
              label={t('Request Count')}
              value={formatNumber(props.data.user.request_count)}
              icon={Hash}
              tone='info'
            />
          </div>
        </>
      )}

      <section className='space-y-2'>
        <h3 className='text-sm font-semibold'>{summaryTitle}</h3>
        <SummaryMetrics summary={props.data.summary} />
      </section>

      <section className='space-y-2'>
        <h3 className='text-sm font-semibold'>{t('Usage Trends')}</h3>
        <div className='grid gap-3 lg:grid-cols-3'>
          <UsageChart
            data={props.data.daily}
            metric='tokens'
            title={t('Token Trend')}
            color='#2563eb'
            range={props.range}
          />
          <UsageChart
            data={props.data.daily}
            metric='cost'
            title={t('Cost Trend')}
            color='#16a34a'
            range={props.range}
          />
          <UsageChart
            data={props.data.daily}
            metric='requests'
            title={t('Request Trend')}
            color='#c2410c'
            range={props.range}
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
