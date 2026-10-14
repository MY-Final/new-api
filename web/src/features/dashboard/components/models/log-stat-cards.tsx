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
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { DashboardAnalytics, DashboardMetricStats } from '../../types'
import { StatDelta } from '../stat-delta'
import { StatCard } from '../ui/stat-card'

interface LogStatCardsProps {
  data: DashboardAnalytics
  previous?: DashboardMetricStats
  loading: boolean
  error: boolean
  personal?: boolean
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
    },
    {
      key: 'count' as const,
      title: t('Requests'),
      description: t('Calls in the selected period'),
      icon: Hash,
    },
    {
      key: 'tokens' as const,
      title: t('Total Tokens'),
      description: t('Input and output tokens'),
      icon: Layers,
    },
  ]

  return items.map((item) => {
    const value = props.data.summary[item.key]
    let display = formatNumber(value, locale)
    if (display.length > 9) display = formatCompactNumber(value, locale)
    if (item.key === 'quota') display = formatQuota(value)
    return (
      <section
        key={item.key}
        aria-label={item.title}
        className='bg-card min-w-0 rounded-xl border p-3 sm:p-4'
      >
        <StatCard
          title={item.title}
          value={display}
          description={item.description}
          icon={item.icon}
          iconTone='info'
          tone='accent-1'
          sparklineVariant='line'
          sparkline={
            props.error || props.loading
              ? []
              : props.data.timeline.map((bucket) => bucket[item.key])
          }
          loading={props.loading}
          error={props.error}
          action={
            !props.loading && !props.error && props.previous ? (
              <StatDelta current={value} previous={props.previous[item.key]} />
            ) : undefined
          }
        />
      </section>
    )
  })
}
