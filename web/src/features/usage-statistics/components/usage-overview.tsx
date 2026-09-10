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
import { useTranslation } from 'react-i18next'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber, formatQuota } from '@/lib/format'

import type { UserUsage, UserUsageAggregate } from '../types'
import { UsageChart } from './usage-chart'

export function UsageMetric(props: { label: string; value: string }) {
  return (
    <div className='rounded-lg border px-3 py-2.5'>
      <div className='text-muted-foreground text-xs'>{props.label}</div>
      <div className='mt-1 text-base font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

export function SummaryMetrics(props: { summary: UserUsageAggregate }) {
  const { t } = useTranslation()
  const metrics = [
    [t('Requests'), formatNumber(props.summary.request_count)],
    [t('Input Tokens'), formatNumber(props.summary.input_tokens)],
    [t('Output Tokens'), formatNumber(props.summary.output_tokens)],
    [t('Cache Read'), formatNumber(props.summary.cache_read_tokens)],
    [t('Cache Write'), formatNumber(props.summary.cache_write_tokens)],
    [t('Reasoning'), formatNumber(props.summary.reasoning_tokens)],
    [t('Total Tokens'), formatNumber(props.summary.total_tokens)],
    [t('User Cost'), formatQuota(props.summary.user_cost)],
  ]

  return (
    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
      {metrics.map(([label, value]) => (
        <UsageMetric key={label} label={label} value={value} />
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
}

export function UsageOverview(props: UsageOverviewProps) {
  const { t } = useTranslation()

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
        </>
      )}

      <section className='space-y-2'>
        <h3 className='text-sm font-semibold'>{t('Period Summary')}</h3>
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
          />
          <UsageChart
            data={props.data.daily}
            metric='cost'
            title={t('Cost Trend')}
            color='#16a34a'
          />
          <UsageChart
            data={props.data.daily}
            metric='requests'
            title={t('Request Trend')}
            color='#c2410c'
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
