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

import { DataTableServerPagination } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { LogsDrilldownLink } from '@/components/logs-drilldown-link'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatCompactNumber,
  formatNumber,
  formatPercent,
  formatQuota,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { UsageStatisticsParams } from '../api'
import type { UserUsageRank, UserUsageRanking as Ranking } from '../types'

interface UserUsageRankingProps {
  data?: Ranking
  loading: boolean
  sortBy: NonNullable<UsageStatisticsParams['sort_by']>
  onSortChange: (metric: NonNullable<UsageStatisticsParams['sort_by']>) => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  range: { start: Date; end: Date }
  modelName?: string
  channel?: number
  onUserSelect: (user: UserUsageRank) => void
}

export function UserUsageRanking(props: UserUsageRankingProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfigStore((state) => state.config.currency)
  const metrics = [
    { key: 'user_cost' as const, label: t('Cost') },
    { key: 'total_tokens' as const, label: t('Tokens') },
    { key: 'request_count' as const, label: t('Consumption records') },
  ]
  const total = props.data?.summary[props.sortBy] ?? 0

  return (
    <PanelWrapper
      title={t('User Usage Ranking')}
      description={
        props.data?.total === 1
          ? t('Only one user matches these filters; there is no comparison.')
          : t('Share of all matching users')
      }
      loading={props.loading}
      height='h-96'
      className='min-w-0 rounded-xl shadow-none'
      headerActions={
        <Tabs
          value={props.sortBy}
          className='max-w-full'
          onValueChange={(value) =>
            props.onSortChange(value as UserUsageRankingProps['sortBy'])
          }
        >
          <TabsList
            className='max-w-full flex-wrap group-data-horizontal/tabs:h-auto'
            aria-label={t('User ranking metric')}
          >
            {metrics.map((metric) => (
              <TabsTrigger key={metric.key} value={metric.key}>
                {metric.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      {props.data?.items.length ? (
        <ol
          className='flex max-h-[36rem] min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain pr-1'
          start={(props.page - 1) * props.pageSize + 1}
        >
          {props.data.items.map((item, index) => {
            const name = item.username || `#${item.user_id}`
            const rank = (props.page - 1) * props.pageSize + index + 1
            const share =
              total > 0 && item[props.sortBy] >= 0
                ? (item[props.sortBy] / total) * 100
                : undefined
            return (
              <li
                key={item.user_id}
                className='bg-muted/20 min-w-0 rounded-lg border p-3'
              >
                <div className='mb-3 flex min-w-0 items-center gap-2'>
                  <span
                    className={cn(
                      'bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums',
                      rank <= 3 && 'bg-primary/10 text-primary'
                    )}
                    aria-hidden='true'
                  >
                    {rank}
                  </span>
                  <Button
                    variant='link'
                    size='sm'
                    className='h-auto min-w-0 shrink justify-start p-0'
                    title={name}
                    onClick={() => props.onUserSelect(item)}
                  >
                    <span className='truncate'>{name}</span>
                  </Button>
                  {item.username && (
                    <div className='ml-auto shrink-0'>
                      <LogsDrilldownLink
                        start={props.range.start}
                        end={props.range.end}
                        username={item.username}
                        model={props.modelName}
                        channel={props.channel}
                      />
                    </div>
                  )}
                </div>
                <dl className='mb-3 grid min-w-0 grid-cols-3 gap-2'>
                  {metrics.map((metric) => (
                    <div key={metric.key} className='min-w-0'>
                      <dt className='text-muted-foreground mb-1 text-[11px] break-words'>
                        {metric.label}
                      </dt>
                      <dd
                        className={cn(
                          'font-mono text-xs break-all tabular-nums sm:text-sm',
                          metric.key === props.sortBy &&
                            'text-primary font-semibold'
                        )}
                        title={
                          metric.key === 'user_cost'
                            ? formatQuota(item[metric.key])
                            : formatNumber(item[metric.key], locale)
                        }
                      >
                        {metric.key === 'user_cost'
                          ? formatQuota(item[metric.key])
                          : formatCompactNumber(item[metric.key], locale)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {(props.data?.total ?? 0) > 1 && (
                  <div className='flex items-center gap-3'>
                    <Progress
                      value={Math.min(100, Math.max(0, share ?? 0))}
                      aria-label={name}
                      aria-valuetext={
                        share === undefined ? '—' : formatPercent(share)
                      }
                      className='min-w-0 flex-1 gap-0'
                    />
                    <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                      {share === undefined ? '—' : formatPercent(share)}
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      ) : (
        <EmptyState title={t('No usage data')} className='min-h-48' />
      )}
      <div className='mt-4 border-t pt-3'>
        <DataTableServerPagination
          compact
          page={props.page}
          pageSize={props.pageSize}
          total={props.data?.total ?? 0}
          onPageChange={props.onPageChange}
          onPageSizeChange={props.onPageSizeChange}
        />
      </div>
    </PanelWrapper>
  )
}
