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
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber, formatNumber, formatPercent } from '@/lib/format'

import type { UserUsageRanking } from '../types'

interface UserUsageInsightsProps {
  data?: UserUsageRanking
  loading: boolean
  view: 'activity' | 'tokens'
}

export function UserUsageInsights(props: UserUsageInsightsProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const activity = [
    {
      label: t('DAU'),
      period: t('Today (server time)'),
      value: props.data?.activity.dau ?? 0,
    },
    {
      label: t('WAU'),
      period: t('Rolling 7 days'),
      value: props.data?.activity.wau ?? 0,
    },
    {
      label: t('MAU'),
      period: t('Rolling 30 days'),
      value: props.data?.activity.mau ?? 0,
    },
  ]
  const tokens = [
    { label: t('Input Tokens'), value: props.data?.summary.input_tokens ?? 0 },
    {
      label: t('Output Tokens'),
      value: props.data?.summary.output_tokens ?? 0,
    },
  ]
  const details = [
    {
      label: t('Cache Read'),
      value: props.data?.summary.cache_read_tokens ?? 0,
    },
    {
      label: t('Cache Write'),
      value: props.data?.summary.cache_write_tokens ?? 0,
    },
    { label: t('Reasoning'), value: props.data?.summary.reasoning_tokens ?? 0 },
  ]
  const total = props.data?.summary.total_tokens ?? 0

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      {props.view === 'activity' && (
        <PanelWrapper
          title={t('Current user activity')}
          description={t(
            'All-site activity now, independent of the selected filters'
          )}
          loading={props.loading}
          height='h-40'
          className='min-w-0 rounded-xl shadow-none'
          headerActions={
            <div className='flex max-w-full items-center gap-2'>
              <Badge
                variant='outline'
                className='border-info/30 bg-info/10 text-info h-auto whitespace-normal'
              >
                {t('Site-wide · Today / rolling 7 / 30 days')}
              </Badge>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-xs'
                      aria-label={t('Activity scope')}
                    />
                  }
                >
                  <Info aria-hidden='true' />
                </TooltipTrigger>
                <TooltipContent className='max-w-[min(24rem,calc(100vw-2rem))] leading-relaxed'>
                  {t(
                    'Distinct users with consumption records site-wide. DAU starts at server-local midnight; WAU and MAU cover the last 7 and 30 days. Selected periods and filters do not apply.'
                  )}
                </TooltipContent>
              </Tooltip>
            </div>
          }
        >
          <div className='grid gap-4 sm:grid-cols-3'>
            {activity.map((item) => (
              <div key={item.label}>
                <div className='mb-2 flex items-baseline justify-between gap-3'>
                  <div className='min-w-0 text-xs font-medium'>
                    {item.label}
                    <span className='text-muted-foreground ml-2 font-normal'>
                      {item.period}
                    </span>
                  </div>
                  <span
                    className='shrink-0 font-mono text-lg font-semibold tabular-nums'
                    title={formatNumber(item.value, locale)}
                  >
                    {formatCompactNumber(item.value, locale)}
                  </span>
                </div>
                <Progress
                  value={
                    props.data?.activity.mau
                      ? Math.min(
                          100,
                          (item.value / props.data.activity.mau) * 100
                        )
                      : 0
                  }
                  aria-label={item.label}
                  className='gap-0'
                />
              </div>
            ))}
          </div>
        </PanelWrapper>
      )}
      {props.view === 'tokens' && (
        <PanelWrapper
          title={t('Token breakdown')}
          description={t('Usage Period')}
          loading={props.loading}
          height='h-52'
          className='min-w-0 rounded-xl shadow-none'
        >
          <div className='flex flex-col gap-4'>
            {tokens.map((item) => {
              const share = total > 0 ? (item.value / total) * 100 : 0
              return (
                <div key={item.label}>
                  <div className='mb-2 flex items-start justify-between gap-3 text-xs'>
                    <span className='text-muted-foreground min-w-0'>
                      {item.label}
                    </span>
                    <span
                      className='shrink-0 font-mono tabular-nums'
                      title={formatNumber(item.value, locale)}
                    >
                      {formatCompactNumber(item.value, locale)}
                      <span className='text-muted-foreground ml-2'>
                        {formatPercent(share)}
                      </span>
                    </span>
                  </div>
                  <Progress
                    value={Math.min(100, Math.max(0, share))}
                    aria-label={item.label}
                    className='gap-0'
                  />
                </div>
              )
            })}
            <dl className='flex flex-col gap-3 border-t pt-4 text-xs'>
              {details.map((item) => (
                <div
                  key={item.label}
                  className='flex items-start justify-between gap-3'
                >
                  <dt className='text-muted-foreground min-w-0'>
                    {item.label}
                  </dt>
                  <dd
                    className='shrink-0 font-mono tabular-nums'
                    title={formatNumber(item.value, locale)}
                  >
                    {formatCompactNumber(item.value, locale)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className='text-muted-foreground text-[11px] leading-relaxed'>
              {t(
                'Cache tokens are included in input; reasoning tokens are included in output.'
              )}
            </p>
          </div>
        </PanelWrapper>
      )}
    </div>
  )
}
