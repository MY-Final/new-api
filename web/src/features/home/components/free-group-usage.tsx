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
  const personal = props.usage?.user
  const displayLimit = personal?.limit ?? dailyLimit
  const displayUsed = personal?.used ?? used
  const displayRemaining = personal?.remaining ?? props.usage?.remaining ?? 0
  const progressLimit = displayLimit > 0 ? displayLimit : dailyLimit
  const progressUsed = displayLimit > 0 ? displayUsed : used
  const progress =
    progressLimit > 0 ? Math.min((progressUsed / progressLimit) * 100, 100) : 0

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
        <div className='text-primary-foreground/70 mb-1 text-[10px] font-black tracking-[0.16em] uppercase'>
          {personal ? t('Your calls today') : t('Free group calls today')}
        </div>
        <div className='text-3xl font-black tracking-tight tabular-nums sm:text-4xl'>
          {formatNumber(displayUsed, locale)}
          {displayLimit > 0 && (
            <span className='text-primary-foreground/70 text-lg font-medium sm:text-xl'>
              {' / '}
              {formatNumber(displayLimit, locale)}
            </span>
          )}
        </div>
        <div className='text-primary-foreground/80 mt-1 text-xs tabular-nums'>
          {displayLimit > 0
            ? t('Remaining today: {{remaining}}', {
                remaining: formatNumber(displayRemaining, locale),
              })
            : t('Unlimited')}
        </div>
        {personal && (
          <div className='border-primary-foreground/20 text-primary-foreground/70 mt-2 border-t pt-2 text-[11px] tabular-nums'>
            {t('Site total')}: {formatNumber(used, locale)} /{' '}
            {formatNumber(dailyLimit, locale)}
            {' · '}
            {t('Remaining today: {{remaining}}', {
              remaining: formatNumber(props.usage?.remaining ?? 0, locale),
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <section
      aria-label={t('Free group calls today')}
      className='border-primary/25 bg-card/90 shadow-primary/5 relative w-full overflow-hidden rounded-[1.75rem] border-2 p-5 shadow-lg backdrop-blur-md md:p-6'
    >
      <div
        aria-hidden='true'
        className='from-primary/10 pointer-events-none absolute inset-0 bg-gradient-to-bl to-transparent to-40%'
      />
      <div
        aria-hidden='true'
        className='border-primary/5 pointer-events-none absolute -top-16 -right-10 size-40 rounded-full border-[18px]'
      />

      <div className='relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between'>
        <div className='flex items-start gap-4'>
          <div className='bg-primary text-primary-foreground grid size-12 shrink-0 place-items-center rounded-2xl shadow-md'>
            <Activity className='size-6' aria-hidden='true' />
          </div>
          <div>
            <div className='flex flex-wrap items-center gap-2'>
              <p className='text-primary text-[11px] font-black tracking-[0.2em] uppercase'>
                {t('Daily')}
              </p>
              <h3 className='text-base font-black tracking-tight md:text-lg'>
                {t('Free group calls today')}
              </h3>
              {props.usage?.enabled && props.usage.group && (
                <>
                  <Badge
                    variant='outline'
                    className='border-primary/30 bg-primary/10 text-primary'
                  >
                    {props.usage.group}
                  </Badge>
                  <FreeGroupScheduleDialog />
                </>
              )}
            </div>
            <p className='text-muted-foreground mt-2 text-xs leading-5'>
              {t('The daily limit resets at midnight UTC+8.')}
            </p>
          </div>
        </div>

        <div className='bg-primary text-primary-foreground min-w-52 rounded-2xl px-5 py-3.5 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.8)]'>
          {value}
        </div>
      </div>
      {props.usage?.enabled && !props.isError && (
        <Progress
          aria-label={t('Progress for free group calls')}
          value={progress}
          className='[&_[data-slot=progress-indicator]]:bg-primary [&_[data-slot=progress-track]]:bg-primary/10 relative mt-5 [&_[data-slot=progress-track]]:h-2'
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

  const personal = props.usage.user
  const displayUsed = formatNumber(personal?.used ?? props.usage.used, locale)
  const displayLimit = personal?.limit ?? props.usage.daily_limit
  const displayRemaining = personal?.remaining ?? props.usage.remaining
  const remaining = t('Remaining today: {{remaining}}', {
    remaining:
      displayLimit > 0
        ? formatNumber(displayRemaining, locale)
        : t('Unlimited'),
  })
  const label = `${personal ? t('Your calls today') : t('Free group calls today')}: ${props.usage.group}, ${displayUsed}${
    displayLimit > 0 ? ` / ${formatNumber(displayLimit, locale)}` : ''
  }, ${remaining}`

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
      <span className='shrink-0 font-semibold'>{displayUsed}</span>
      {displayLimit > 0 && (
        <span className='text-muted-foreground shrink-0'>
          / {formatNumber(displayLimit, locale)}
        </span>
      )}
    </div>
  )
}
