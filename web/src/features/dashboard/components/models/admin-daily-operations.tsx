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
import { Activity, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useTopSpenders } from '@/features/dashboard/hooks/use-top-spenders'
import { useFreeGroupUsage } from '@/features/home/hooks/use-free-group-usage'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { StatCard } from '../ui/stat-card'

interface AdminDailyOperationsProps {
  range: { start: Date; end: Date }
  refetchInterval: number | false
}

export function AdminDailyOperations(props: AdminDailyOperationsProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const freeGroupQuery = useFreeGroupUsage(props.refetchInterval)
  const activityQuery = useTopSpenders(props.range, props.refetchInterval)
  const freeUsage = freeGroupQuery.data
  const activity = activityQuery.data?.activity

  let freeCalls = '--'
  if (freeUsage?.enabled) {
    freeCalls = `${formatNumber(freeUsage.used, locale)} / ${formatNumber(freeUsage.daily_limit, locale)}`
  } else if (freeUsage) {
    freeCalls = t('Disabled')
  }
  const freeProgress =
    freeUsage && freeUsage.daily_limit > 0
      ? Math.min(
          100,
          Math.max(0, (freeUsage.used / freeUsage.daily_limit) * 100)
        )
      : 0
  const activityDetails = activity
    ? [
        { label: t('DAU'), value: formatNumber(activity.dau, locale) },
        { label: t('WAU'), value: formatNumber(activity.wau, locale) },
        { label: t('MAU'), value: formatNumber(activity.mau, locale) },
      ]
    : undefined

  return (
    <section
      aria-label={t('Operations Overview')}
      className='grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]'
    >
      <section
        aria-label={t('Free group calls today')}
        className='bg-card min-w-0 rounded-xl border p-4 sm:p-5'
      >
        <StatCard
          title={t('Free group calls today')}
          value={freeCalls}
          description={t('The daily limit resets at midnight Beijing time.')}
          icon={Activity}
          tone='accent-1'
          iconTone='chart-1'
          loading={freeGroupQuery.isLoading}
          error={freeGroupQuery.isError}
          compact
          titleAction={
            freeUsage?.enabled && freeUsage.group ? (
              <Badge variant='outline'>{freeUsage.group}</Badge>
            ) : undefined
          }
          valueClassName='text-2xl leading-none sm:text-3xl'
          visualization={
            freeUsage?.enabled ? (
              <div className='flex flex-col gap-1.5'>
                <div className='text-muted-foreground flex items-center justify-between gap-3 text-[11px]'>
                  <span>{t('Daily')}</span>
                  <span className='font-mono tabular-nums'>
                    {formatNumber(freeProgress, locale)}%
                  </span>
                </div>
                <Progress
                  aria-label={t('Progress for free group calls')}
                  value={freeProgress}
                  className='[&_[data-slot=progress-track]]:h-2'
                />
                <div className='grid grid-cols-2 gap-2 pt-1'>
                  <div className='bg-muted/40 text-foreground rounded-lg px-2.5 py-2 text-xs font-semibold tabular-nums'>
                    {t('Used today: {{used}}', {
                      used: formatNumber(freeUsage.used, locale),
                    })}
                  </div>
                  <div className='bg-muted/40 text-foreground rounded-lg px-2.5 py-2 text-xs font-semibold tabular-nums'>
                    {t('Remaining today: {{remaining}}', {
                      remaining: formatNumber(freeUsage.remaining, locale),
                    })}
                  </div>
                </div>
              </div>
            ) : undefined
          }
          showVisualizationInCompact
        />
      </section>

      <section
        aria-label={t('Active users')}
        className='bg-card min-w-0 rounded-xl border p-4 sm:p-5'
      >
        <StatCard
          title={t('Active users')}
          value={activity ? formatNumber(activity.dau, locale) : '--'}
          description={t(
            'All-site activity now, independent of the selected filters'
          )}
          icon={Users}
          tone='accent-2'
          iconTone='chart-2'
          loading={activityQuery.loading}
          error={activityQuery.error}
          compact
          visualization={
            activityDetails ? (
              <div className='grid grid-cols-3 gap-2'>
                {activityDetails.map((detail) => (
                  <div
                    key={detail.label}
                    className='bg-muted/40 min-w-0 rounded-lg px-2.5 py-2'
                  >
                    <div className='text-muted-foreground truncate text-[11px] font-medium'>
                      {detail.label}
                    </div>
                    <div className='mt-1.5 truncate font-mono text-xs font-semibold tabular-nums'>
                      {detail.value}
                    </div>
                  </div>
                ))}
              </div>
            ) : undefined
          }
          valueClassName='text-2xl leading-none sm:text-3xl'
          showVisualizationInCompact
        />
      </section>
    </section>
  )
}
