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
import { Coins, Hash, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type {
  DashboardAnalytics,
  DashboardMetric,
  DashboardMetricStats,
} from '../../types'
import { StatDelta } from '../stat-delta'
import { StatCard } from '../ui/stat-card'

interface LogStatCardsProps {
  data: DashboardAnalytics
  previous?: DashboardMetricStats
  loading: boolean
  error: boolean
  personal?: boolean
  compact?: boolean
  metricKeys?: readonly DashboardMetric[]
}

export function LogStatCards(props: LogStatCardsProps) {
  useSystemConfigStore((state) => state.config.currency)
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const items = [
    {
      key: 'quota' as const,
      title: props.personal
        ? t('Period consumption')
        : t('User quota consumption'),
      description: props.personal
        ? t('Your charges in the selected period')
        : t('User-side charges in the selected period'),
      icon: Coins,
      tone: 'accent-1' as const,
      iconTone: 'chart-1' as const,
    },
    {
      key: 'count' as const,
      title: t('Requests'),
      description: t('Calls in the selected period'),
      icon: Hash,
      tone: 'accent-2' as const,
      iconTone: 'chart-2' as const,
    },
    {
      key: 'tokens' as const,
      title: t('Total Tokens'),
      description: t('Input and output tokens'),
      icon: Layers,
      tone: 'accent-3' as const,
      iconTone: 'chart-3' as const,
    },
  ].filter((item) => !props.metricKeys || props.metricKeys.includes(item.key))

  return items.map((item) => {
    const value = props.data.summary[item.key]
    let display = formatNumber(value, locale)
    if (display.length > 9) display = formatCompactNumber(value, locale)
    if (item.key === 'quota') display = formatQuota(value)
    // The site-wide view leads with spend: it is the number an operator is
    // actually watching, so it gets more width and a trend line of its own.
    const featured = props.compact && !props.personal && item.key === 'quota'
    return (
      <section
        key={item.key}
        aria-label={item.title}
        className={cn(
          'bg-card flex min-w-0 flex-col',
          props.compact ? 'p-4 sm:p-5' : 'rounded-xl border p-3 sm:p-4',
          featured && 'col-span-2 lg:col-span-1'
        )}
      >
        <StatCard
          title={item.title}
          value={display}
          description={item.description}
          icon={item.icon}
          iconTone={item.iconTone}
          compact={props.compact}
          className={props.compact ? 'h-full' : undefined}
          valueClassName={
            featured ? 'text-[2rem] leading-none sm:text-[2.5rem]' : undefined
          }
          tone={item.tone}
          sparklineVariant='line'
          sparklineClassName={featured ? 'h-12' : undefined}
          sparkline={
            props.error || props.loading
              ? []
              : props.data.timeline.map((bucket) => bucket[item.key])
          }
          showVisualizationInCompact={featured && props.data.summary.quota > 0}
          loading={props.loading}
          error={props.error}
          action={
            !props.loading && !props.error && props.previous ? (
              <StatDelta current={value} previous={props.previous[item.key]} />
            ) : undefined
          }
        />
        {item.key === 'quota' && !props.loading && !props.error && (
          <div className='text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums'>
            <span>{t('Wallet')}: {formatQuota(props.data.summary.walletQuota)}</span>
            <span>{t('Subscription')}: {formatQuota(props.data.summary.subscriptionQuota)}</span>
            <span>{t('Unknown')}: {formatQuota(props.data.unknownQuota)}</span>
          </div>
        )}
      </section>
    )
  })
}
