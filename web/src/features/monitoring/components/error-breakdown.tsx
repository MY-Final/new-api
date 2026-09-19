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

import { LogsDrilldownLink } from '@/components/logs-drilldown-link'
import { Badge } from '@/components/ui/badge'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { LogAnalysisData, LogAnalysisErrorCode } from '../types'
import { ErrorTrend } from './error-trend'

interface ErrorBreakdownProps {
  data: LogAnalysisData
  start: Date
  end: Date
}

function statusBadgeVariant(status: number) {
  if (status >= 500) return 'destructive' as const
  if (status === 429) return 'warning' as const
  if (status > 0) return 'secondary' as const
  return 'outline' as const
}

function ErrorCodeRow(props: {
  entry: LogAnalysisErrorCode
  maxCount: number
  start: Date
  end: Date
}) {
  const { t } = useTranslation()
  const share = props.maxCount > 0 ? props.entry.count / props.maxCount : 0

  return (
    <li className='flex items-start gap-2 py-2'>
      <Badge
        variant={statusBadgeVariant(props.entry.status_code)}
        className='mt-0.5 font-mono tabular-nums'
      >
        {props.entry.status_code > 0 ? props.entry.status_code : '—'}
      </Badge>
      <div className='min-w-0 flex-1'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='truncate font-mono text-xs font-medium'>
            {props.entry.error_code || t('Unknown error')}
          </span>
          {props.entry.error_type ? (
            <span className='text-muted-foreground hidden text-[10px] sm:inline'>
              {props.entry.error_type}
            </span>
          ) : null}
          <span className='ml-auto shrink-0 font-mono text-xs font-semibold tabular-nums'>
            {formatNumber(props.entry.count)}
          </span>
          <LogsDrilldownLink start={props.start} end={props.end} errorOnly />
        </div>
        <div className='bg-muted mt-1 h-1 overflow-hidden rounded-full'>
          <div
            className='bg-destructive/70 h-full rounded-full'
            style={{ width: `${Math.max(share * 100, 2)}%` }}
          />
        </div>
        {props.entry.sample ? (
          <p
            className='text-muted-foreground mt-1 line-clamp-1 text-[11px]'
            title={props.entry.sample}
          >
            {props.entry.sample}
          </p>
        ) : null}
      </div>
    </li>
  )
}

interface RankItem {
  key: string
  label: string
  count: number
  link: React.ReactNode
}

function ErrorRankList(props: { title: string; items: RankItem[] }) {
  const { t } = useTranslation()
  const maxCount = props.items[0]?.count ?? 0

  return (
    <section className='min-w-0'>
      <h4 className='text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase'>
        {props.title}
      </h4>
      {props.items.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          {t('No errors in this period')}
        </p>
      ) : (
        <ul className='space-y-1'>
          {props.items.map((item) => (
            <li key={item.key} className='flex min-w-0 items-center gap-2'>
              <span
                className='min-w-0 flex-1 truncate text-xs'
                title={item.label}
              >
                {item.label}
              </span>
              <span className='bg-muted h-1 w-16 overflow-hidden rounded-full'>
                <span
                  className='bg-destructive/70 block h-full rounded-full'
                  style={{
                    width: `${maxCount > 0 ? Math.max((item.count / maxCount) * 100, 4) : 0}%`,
                  }}
                />
              </span>
              <span className='w-10 shrink-0 text-right font-mono text-xs tabular-nums'>
                {formatNumber(item.count)}
              </span>
              {item.link}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ErrorBreakdown(props: ErrorBreakdownProps) {
  const { t } = useTranslation()
  const data = props.data
  const totalErrors = data.error_codes.reduce(
    (sum, entry) => sum + entry.count,
    0
  )
  const maxCount = data.error_codes[0]?.count ?? 0

  const channelNames = new Map(
    data.channels.map((channel) => [channel.channel_id, channel.channel_name])
  )

  const modelItems: RankItem[] = data.error_models.map((item) => ({
    key: `model-${item.model_name}`,
    label: item.model_name || t('Unknown'),
    count: item.count,
    link: (
      <LogsDrilldownLink
        start={props.start}
        end={props.end}
        model={item.model_name}
        errorOnly
      />
    ),
  }))

  const channelItems: RankItem[] = data.error_channels.map((item) => {
    const name = channelNames.get(item.channel_id)
    return {
      key: `channel-${item.channel_id}`,
      label: name ? `${name} (#${item.channel_id})` : `#${item.channel_id}`,
      count: item.count,
      link: (
        <LogsDrilldownLink
          start={props.start}
          end={props.end}
          channel={item.channel_id}
          errorOnly
        />
      ),
    }
  })

  const userItems: RankItem[] = data.top_error_users.map((item) => ({
    key: `user-${item.user_id}`,
    label: item.username || `#${item.user_id}`,
    count: item.count,
    link: (
      <LogsDrilldownLink
        start={props.start}
        end={props.end}
        username={item.username || undefined}
        errorOnly
      />
    ),
  }))

  const tokenItems: RankItem[] = data.top_error_tokens.map((item) => ({
    key: `token-${item.token_id}`,
    label: item.token_name || `#${item.token_id}`,
    count: item.count,
    link: (
      <LogsDrilldownLink
        start={props.start}
        end={props.end}
        token={item.token_name || undefined}
        errorOnly
      />
    ),
  }))

  return (
    <div className='space-y-4 px-4 py-3 sm:px-5'>
      <section className='min-w-0'>
        <div className='mb-2 flex flex-wrap items-center gap-x-3 gap-y-1'>
          <h4 className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>
            {t('Error trend')}
          </h4>
          <span className='text-muted-foreground text-[11px]'>
            {t('{{count}} errors', { count: formatNumber(totalErrors) })}
          </span>
        </div>
        <ErrorTrend points={data.trend} bucketSeconds={data.bucket_seconds} />
      </section>

      <section className='min-w-0'>
        <div className='mb-1 flex flex-wrap items-center gap-x-3 gap-y-1'>
          <h4 className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>
            {t('Failure reasons')}
          </h4>
          {data.error_logs_truncated ? (
            <span className='text-[11px] text-amber-600 dark:text-amber-400'>
              {t('Distribution estimated from the most recent error logs')}
            </span>
          ) : null}
        </div>
        {data.error_codes.length === 0 ? (
          <p className='text-muted-foreground text-xs'>
            {t('No errors in this period')}
          </p>
        ) : (
          <ul className='divide-border/60 divide-y'>
            {data.error_codes.map((entry) => (
              <ErrorCodeRow
                key={`${entry.error_code}-${entry.status_code}`}
                entry={entry}
                maxCount={maxCount}
                start={props.start}
                end={props.end}
              />
            ))}
          </ul>
        )}
      </section>

      <div className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2')}>
        <ErrorRankList title={t('Failed by model')} items={modelItems} />
        <ErrorRankList title={t('Failed by channel')} items={channelItems} />
        <ErrorRankList title={t('Top failing users')} items={userItems} />
        <ErrorRankList title={t('Top failing keys')} items={tokenItems} />
      </div>
    </div>
  )
}
