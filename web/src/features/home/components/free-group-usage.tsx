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
import { Activity } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { FreeGroupUsageState } from '../types'
import { FreeGroupScheduleDialog } from './free-group-schedule'

type FreeGroupUsageProps = FreeGroupUsageState

export function FreeGroupUsage(props: FreeGroupUsageProps) {
  const { i18n, t } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const dailyLimit = props.usage?.daily_limit ?? 0
  const used = props.usage?.used ?? 0
  const progress = dailyLimit > 0 ? Math.min((used / dailyLimit) * 100, 100) : 0

  if (props.usage?.enabled === false) {
    return null
  }

  let value: ReactNode
  if (props.isLoading) {
    value = <Skeleton className='h-8 w-28' />
  } else if (props.isError || !props.usage) {
    value = (
      <Badge variant='outline' className='text-muted-foreground'>
        {t('Unavailable')}
      </Badge>
    )
  } else {
    value = (
      <div className='text-right'>
        <div className='text-3xl font-black tracking-tight tabular-nums sm:text-4xl'>
          {formatNumber(used, locale)}
          <span className='text-lg font-medium text-white/65 sm:text-xl'>
            {' / '}
            {formatNumber(dailyLimit, locale)}
          </span>
        </div>
        <div className='mt-1 text-xs text-white/75 tabular-nums'>
          {t('Remaining today: {{remaining}}', {
            remaining: formatNumber(props.usage.remaining, locale),
          })}
        </div>
      </div>
    )
  }

  return (
    <section
      aria-label={t('Free group calls today')}
      className='relative w-full overflow-hidden rounded-[1.75rem] border-2 border-orange-500/35 bg-white/90 p-5 shadow-[0_18px_50px_-28px_rgba(249,115,22,0.65)] backdrop-blur-md md:p-6 dark:border-orange-400/30 dark:bg-[#211b17]/95 dark:shadow-[0_18px_50px_-28px_rgba(249,115,22,0.45)]'
    >
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_95%_0%,rgba(249,115,22,0.16),transparent_35%)] dark:bg-[radial-gradient(circle_at_95%_0%,rgba(249,115,22,0.2),transparent_35%)]'
      />
      <div
        aria-hidden='true'
        className='pointer-events-none absolute -top-16 -right-10 size-40 rounded-full border-[18px] border-orange-500/[0.06]'
      />

      <div className='relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between'>
        <div className='flex items-start gap-4'>
          <div className='grid size-12 shrink-0 place-items-center rounded-2xl bg-orange-500 text-white shadow-[0_10px_25px_-8px_rgba(249,115,22,0.9)]'>
            <Activity className='size-6' aria-hidden='true' />
          </div>
          <div>
            <div className='flex flex-wrap items-center gap-2'>
              <p className='text-[11px] font-black tracking-[0.2em] text-orange-700 uppercase dark:text-orange-400'>
                {t('Daily')}
              </p>
              <h3 className='text-base font-black tracking-tight md:text-lg'>
                {t('Free group calls today')}
              </h3>
              {props.usage?.enabled && props.usage.group && (
                <>
                  <Badge
                    variant='outline'
                    className='border-orange-500/30 bg-orange-500/10 text-orange-800 dark:text-orange-200'
                  >
                    {props.usage.group}
                  </Badge>
                  <FreeGroupScheduleDialog />
                </>
              )}
            </div>
            <p className='mt-2 text-xs leading-5 text-[#6b6259] dark:text-[#c9c0b5]'>
              {t('The daily limit resets at midnight UTC+8.')}
            </p>
          </div>
        </div>

        <div className='min-w-52 rounded-2xl bg-[#1a1a1a] px-5 py-3.5 text-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.8)] dark:bg-orange-500'>
          {value}
        </div>
      </div>
      {props.usage?.enabled && !props.isError && (
        <Progress
          aria-label={t('Progress for free group calls')}
          value={progress}
          className='relative mt-5 [&_[data-slot=progress-indicator]]:bg-gradient-to-r [&_[data-slot=progress-indicator]]:from-orange-500 [&_[data-slot=progress-indicator]]:to-amber-400 [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-orange-950/10 dark:[&_[data-slot=progress-track]]:bg-black/30'
        />
      )}
    </section>
  )
}

export function FreeGroupUsageIndicator(props: FreeGroupUsageProps) {
  const { i18n, t } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  if (props.usage?.enabled === false) {
    return null
  }

  if (props.isLoading) {
    return <Skeleton className='h-8 w-20 rounded-full' />
  }

  if (props.isError || !props.usage) {
    return (
      <Badge
        variant='outline'
        className='text-muted-foreground h-8 gap-1.5 rounded-full px-2.5'
      >
        <Activity className='size-3.5' aria-hidden='true' />
        {t('Unavailable')}
      </Badge>
    )
  }

  const used = formatNumber(props.usage.used, locale)
  const dailyLimit = formatNumber(props.usage.daily_limit, locale)
  const remaining = t('Remaining today: {{remaining}}', {
    remaining: formatNumber(props.usage.remaining, locale),
  })
  const label = `${t('Free group calls today')}: ${props.usage.group}, ${used} / ${dailyLimit}, ${remaining}`

  return (
    <div
      aria-label={label}
      title={label}
      className={cn(
        'border-border/60 bg-background/70 inline-flex h-8 max-w-52 items-center gap-1.5 rounded-full border px-2.5 text-xs shadow-xs backdrop-blur-sm',
        'tabular-nums'
      )}
    >
      <Activity
        className='size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400'
        aria-hidden='true'
      />
      <span className='text-muted-foreground hidden max-w-24 truncate xl:inline'>
        {props.usage.group}
      </span>
      <span className='shrink-0 font-semibold'>{used}</span>
      <span className='text-muted-foreground shrink-0'>/ {dailyLimit}</span>
    </div>
  )
}
