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
import {
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  Flame,
  Gift,
  History,
  Sparkles,
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency, getCurrencyDisplay } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { useCheckin } from '../hooks/use-checkin'
import { CheckinTurnstileDialog } from './checkin-turnstile-dialog'

interface CheckinCalendarCardProps {
  checkinEnabled: boolean
  turnstileEnabled: boolean
  turnstileSiteKey: string
}

export function CheckinCalendarCard({
  checkinEnabled,
  turnstileEnabled,
  turnstileSiteKey,
}: CheckinCalendarCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
    return new Date(now.getUTCFullYear(), now.getUTCMonth(), 1)
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const todayMonth = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 7)

  const currentMonthStr = useMemo(() => {
    return dayjs(currentMonth).format('YYYY-MM')
  }, [currentMonth])

  const {
    data: checkinData,
    isLoading: monthLoading,
    isError: monthError,
    refetch: refetchMonth,
    recordsMap: checkinRecordsMap,
  } = useCheckin({
    enabled: checkinEnabled,
    turnstileEnabled,
    turnstileSiteKey,
    month: currentMonthStr,
  })

  const current = useCheckin({
    enabled: checkinEnabled,
    turnstileEnabled,
    turnstileSiteKey,
    month: todayMonth,
  })
  const {
    todayString,
    checkedToday,
    todayAward,
    checkinLoading,
    startCheckin,
    turnstile,
  } = current
  const todayDate = new Date(`${todayString}T00:00:00Z`)
  const monday = new Date(todayDate)
  monday.setUTCDate(todayDate.getUTCDate() - ((todayDate.getUTCDay() + 6) % 7))
  const previousMonth = monday.toISOString().slice(0, 7)
  const previous = useCheckin({
    enabled: checkinEnabled && previousMonth !== todayMonth,
    turnstileEnabled,
    turnstileSiteKey,
    month: previousMonth,
  })
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setUTCDate(monday.getUTCDate() + index)
    return date
  })
  const weekRecords = { ...previous.recordsMap, ...current.recordsMap }
  const weekdayFormatter = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'UTC',
  })

  // Subscribe so both the amounts and the unit follow currency setting changes.
  useSystemConfigStore((state) => state.config.currency)

  // The reward amounts are quota units: show the number alone and put the
  // currency unit next to the label. A wide custom symbol (e.g. an emoji) inside
  // the value makes these narrow cells wrap, which then breaks the row.
  const { meta: currencyMeta } = getCurrencyDisplay()
  const quotaUnit =
    currencyMeta.kind === 'tokens' ? t('Tokens') : currencyMeta.symbol
  const statCells = [
    {
      key: 'monthly-checkins',
      value: formatNumber(current.data?.stats?.checkin_count || 0, locale),
      label: t("This month's check-ins"),
      unit: '',
      icon: CalendarCheck,
      tone: 'info' as const,
    },
    {
      key: 'streak',
      value: formatNumber(current.data?.stats?.current_streak || 0, locale),
      label: t('Current streak'),
      unit: '',
      icon: Flame,
      tone: 'warning' as const,
    },
    {
      key: 'monthly-quota',
      // The queried month drives the calendar, so label the amount with that
      // month instead of claiming "this month" while browsing another one.
      value: formatQuotaWithCurrency(current.monthlyQuota, {
        digitsLarge: 0,
        showSymbol: false,
      }),
      label: t("This month's rewards"),
      unit: quotaUnit,
      icon: Gift,
      tone: 'success' as const,
    },
    {
      key: 'total-quota',
      value: formatQuotaWithCurrency(current.data?.stats?.total_quota || 0, {
        digitsLarge: 0,
        showSymbol: false,
      }),
      label: t('Total earned'),
      unit: quotaUnit,
      icon: Sparkles,
      tone: 'primary' as const,
    },
  ]

  const handlePrevMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    )
  }

  const handleNextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    )
  }

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startDayOfWeek = (firstDay.getDay() + 6) % 7

    const days: Array<{ date: Date; isCurrentMonth: boolean }> = []

    // Fill leading empty days
    for (let i = 0; i < startDayOfWeek; i++) {
      const d = new Date(year, month, -startDayOfWeek + i + 1)
      days.push({ date: d, isCurrentMonth: false })
    }

    // Fill current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true })
    }

    // Fill trailing empty days to complete the grid
    const remaining = 7 - (days.length % 7)
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false })
      }
    }

    return days
  }, [currentMonth])

  const weekDays = weekDates.map((date) => weekdayFormatter.format(date))

  if (!checkinEnabled) {
    return null
  }

  if (current.isLoading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <div className='p-6'>
          <div className='flex items-start justify-between gap-4'>
            <div className='flex items-center gap-3'>
              <Skeleton className='h-10 w-10 rounded-xl' />
              <div className='space-y-2'>
                <Skeleton className='h-5 w-32' />
                <Skeleton className='h-3 w-56' />
              </div>
            </div>
            <Skeleton className='h-9 w-28 rounded-md' />
          </div>
        </div>
      </Card>
    )
  }
  if (current.isError) {
    return (
      <ErrorState
        title={t('Failed to fetch checkin status')}
        onRetry={() => current.refetch()}
      />
    )
  }

  let checkinButtonLabel = t('Check in now')
  if (checkinLoading) {
    checkinButtonLabel = t('Loading...')
  } else if (checkedToday) {
    checkinButtonLabel = t('Checked in')
  }

  return (
    <TooltipProvider delay={100}>
      <CheckinTurnstileDialog siteKey={turnstileSiteKey} state={turnstile} />

      <div className='space-y-6 sm:space-y-8'>
        <header className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <p className='text-primary text-xs font-semibold tracking-widest uppercase'>
              {t('Entertainment')}
            </p>
            <h1 className='mt-2 text-2xl font-bold tracking-tight sm:text-3xl'>
              {t('Daily Check-in')}
            </h1>
            <p className='text-muted-foreground mt-2 text-sm'>
              {t('Check in daily to receive random quota rewards')}
            </p>
          </div>
          <p className='text-muted-foreground flex items-center gap-2 text-xs tabular-nums'>
            <CalendarDays className='size-4' /> {todayString}
          </p>
        </header>

        <section className='from-primary/10 via-card to-card text-card-foreground overflow-hidden rounded-2xl border bg-gradient-to-br shadow-sm'>
          <div className='flex flex-col justify-between gap-8 p-6 sm:p-8 md:flex-row md:items-center'>
            <div className='max-w-xl'>
              <span className='border-primary/20 bg-primary/10 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium'>
                <Sparkles className='size-3.5' />
                {checkedToday ? t('Checked in') : t('Daily Check-in')}
              </span>
              <h2 className='mt-4 text-xl font-bold tracking-tight sm:text-2xl'>
                {checkedToday
                  ? t('See you tomorrow')
                  : t('Your daily reward awaits')}
              </h2>
              <p className='text-muted-foreground mt-3 text-sm leading-6'>
                {t('Rewards will be added directly to your balance')}
              </p>
              <div className='mt-5 flex flex-wrap items-center gap-3'>
                <Button
                  onClick={startCheckin}
                  disabled={checkinLoading || checkedToday}
                  className='hover:bg-primary/90'
                >
                  <CalendarCheck className='size-4' /> {checkinButtonLabel}
                </Button>
                <span className='text-muted-foreground text-xs'>
                  {t('Do not repeat check-in; only once per day')}
                </span>
              </div>
            </div>
            <div className='bg-background/70 w-full rounded-xl border p-5 sm:max-w-56'>
              <p className='text-muted-foreground text-xs'>
                {t('Reward range')}
              </p>
              <p className='mt-2 text-lg font-semibold tabular-nums'>
                {current.data?.min_quota === undefined ||
                current.data?.max_quota === undefined
                  ? '—'
                  : `${formatQuotaWithCurrency(current.data.min_quota)} – ${formatQuotaWithCurrency(current.data.max_quota)}`}
              </p>
              <div className='mt-4 border-t pt-4'>
                <p className='text-muted-foreground text-xs'>
                  {t("Today's reward")}
                </p>
                <p className='mt-1 font-semibold tabular-nums'>
                  {todayAward === undefined
                    ? '—'
                    : `+${formatQuotaWithCurrency(todayAward)}`}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className='grid grid-cols-2 gap-4 border-b pb-6 sm:grid-cols-4 sm:gap-6'>
          {statCells.map((stat) => (
            <div key={stat.key} className='flex min-w-0 items-center gap-3'>
              <IconBadge tone={stat.tone} size='lg'>
                <stat.icon />
              </IconBadge>
              <div className='min-w-0'>
                <div
                  data-slot='checkin-stat-label'
                  className='text-muted-foreground flex min-w-0 items-center gap-1 text-xs'
                >
                  <span className='truncate'>{stat.label}</span>
                  {stat.unit ? (
                    <span className='shrink-0'>{stat.unit}</span>
                  ) : null}
                </div>
                <div
                  data-slot='checkin-stat-value'
                  className='mt-1 text-lg font-semibold tracking-tight tabular-nums'
                >
                  {stat.value}
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className='space-y-4 border-b pb-6'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h2 className='text-base font-semibold'>{t('This week')}</h2>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {weekDates[0].toISOString().slice(5, 10)} –{' '}
              {weekDates[6].toISOString().slice(5, 10)}
            </span>
          </div>
          <div className='grid grid-cols-7 gap-1 sm:gap-3'>
            {weekDates.map((date, index) => {
              const key = date.toISOString().slice(0, 10)
              const award = weekRecords[key]
              const unavailable =
                key.slice(0, 7) === previousMonth &&
                previousMonth !== todayMonth &&
                (previous.isLoading || previous.isError)
              let reward = '—'
              if (award !== undefined) {
                reward = `+${formatQuotaWithCurrency(award)}`
              }
              if (unavailable) {
                reward = '…'
              }
              return (
                <div
                  key={key}
                  className='flex min-w-0 flex-col items-center gap-2 text-center'
                >
                  <span className='text-muted-foreground text-xs'>
                    {weekDays[index]}
                  </span>
                  <span
                    className={cn(
                      'flex size-9 items-center justify-center rounded-lg border text-xs sm:size-10',
                      award !== undefined &&
                        'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                      key === todayString && 'ring-2 ring-primary/40'
                    )}
                  >
                    {award !== undefined ? (
                      <Check className='size-4' />
                    ) : (
                      date.getUTCDate()
                    )}
                  </span>
                  <span className='text-muted-foreground max-w-full truncate text-[10px] tabular-nums sm:text-xs'>
                    {reward}
                  </span>
                </div>
              )
            })}
          </div>
          {previousMonth !== todayMonth && previous.isError && (
            <Button
              variant='outline'
              size='sm'
              onClick={() => previous.refetch()}
            >
              {t('Retry')}
            </Button>
          )}
        </section>

        <div className='grid gap-6 lg:grid-cols-2 lg:gap-8'>
          <Card data-card-hover='false' className='gap-0 p-4 sm:p-6'>
            <div className='space-y-3 sm:space-y-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <h2 className='text-base font-semibold'>
                    {t('Check-in calendar')}
                  </h2>
                  <p className='text-muted-foreground mt-1 text-xs tabular-nums'>
                    {currentMonthStr}
                  </p>
                </div>
                <div className='flex items-center gap-0.5 sm:gap-1'>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7 sm:h-8 sm:w-8'
                    aria-label={t('Previous month')}
                    onClick={handlePrevMonth}
                  >
                    <ChevronLeft className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7 sm:h-8 sm:w-8'
                    aria-label={t('Next month')}
                    onClick={handleNextMonth}
                  >
                    <ChevronRight className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
                  </Button>
                </div>
              </div>

              {monthLoading && <Skeleton className='h-64 w-full' />}
              {monthError && (
                <ErrorState
                  title={t('Failed to fetch checkin status')}
                  onRetry={() => refetchMonth()}
                />
              )}
              {!monthLoading && !monthError && (
                <div className='grid grid-cols-7 gap-0.5 sm:gap-1'>
                  {/* Week day headers */}
                  {weekDays.map((day) => (
                    <div
                      key={day}
                      className='text-muted-foreground flex h-7 items-center justify-center text-[10px] font-medium sm:h-8 sm:text-xs'
                    >
                      {day}
                    </div>
                  ))}

                  {/* Calendar days */}
                  {calendarDays.map((dayObj) => {
                    const dateStr = `${dayObj.date.getFullYear()}-${String(
                      dayObj.date.getMonth() + 1
                    ).padStart(2, '0')}-${String(
                      dayObj.date.getDate()
                    ).padStart(2, '0')}`
                    const isToday = dateStr === todayString
                    const quotaAwarded = checkinRecordsMap[dateStr]
                    const isCheckedIn = quotaAwarded !== undefined
                    const dayNum = dayObj.date.getDate()

                    const dayButton = (
                      <Button
                        key={dateStr}
                        variant={isToday ? 'default' : 'ghost'}
                        disabled={!dayObj.isCurrentMonth}
                        onClick={() => setSelectedDate(dateStr)}
                        aria-label={
                          isCheckedIn
                            ? `${dateStr}: +${formatQuotaWithCurrency(quotaAwarded)}`
                            : dateStr
                        }
                        className={cn(
                          'relative flex h-9 w-full flex-col items-center justify-center rounded-lg px-0 text-xs font-medium sm:h-10 sm:text-sm',
                          !dayObj.isCurrentMonth &&
                            'text-muted-foreground/40 cursor-default',
                          !isToday && isCheckedIn && 'font-semibold'
                        )}
                      >
                        <span className='tabular-nums'>{dayNum}</span>
                        {isCheckedIn && !isToday && (
                          <span className='bg-success absolute bottom-0.5 size-1 rounded-full sm:bottom-1' />
                        )}
                      </Button>
                    )

                    if (isCheckedIn && dayObj.isCurrentMonth) {
                      return (
                        <Tooltip key={dateStr}>
                          <TooltipTrigger render={dayButton} />
                          <TooltipContent>
                            <div className='text-xs'>
                              <div className='font-medium'>
                                {t('Checked in')}
                              </div>
                              <div className='text-muted-foreground mt-0.5'>
                                +{formatQuotaWithCurrency(quotaAwarded)}
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )
                    }

                    return dayButton
                  })}
                </div>
              )}

              {selectedDate &&
                checkinRecordsMap[selectedDate] !== undefined && (
                  <p
                    className='text-muted-foreground text-sm'
                    aria-live='polite'
                  >
                    {selectedDate}: +
                    {formatQuotaWithCurrency(checkinRecordsMap[selectedDate])}
                  </p>
                )}
            </div>
          </Card>
          <Card data-card-hover='false' className='gap-0 p-4 sm:p-6'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <h2 className='text-base font-semibold'>
                  {t('Check-in records')}
                </h2>
                <p className='text-muted-foreground mt-1 text-xs tabular-nums'>
                  {currentMonthStr}
                </p>
              </div>
              <History className='text-muted-foreground size-4' />
            </div>
            {monthLoading && <Skeleton className='mt-6 h-32 w-full' />}
            {monthError && (
              <ErrorState
                title={t('Failed to fetch checkin status')}
                onRetry={() => refetchMonth()}
              />
            )}
            {!monthLoading &&
              !monthError &&
              !!checkinData?.stats?.records?.length && (
                <ul className='mt-4 divide-y'>
                  {checkinData.stats.records.map((record) => (
                    <li
                      key={record.checkin_date}
                      className='flex items-center justify-between gap-3 py-3 text-sm'
                    >
                      <span className='flex items-center gap-3'>
                        <IconBadge tone='success' size='sm'>
                          <Check />
                        </IconBadge>
                        <span className='tabular-nums'>
                          {record.checkin_date}
                        </span>
                      </span>
                      <span className='font-medium text-emerald-600 tabular-nums dark:text-emerald-400'>
                        +{formatQuotaWithCurrency(record.quota_awarded)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            {!monthLoading &&
              !monthError &&
              !checkinData?.stats?.records?.length && (
                <p className='text-muted-foreground py-12 text-center text-sm'>
                  {t('No records')}
                </p>
              )}
          </Card>
        </div>
      </div>
    </TooltipProvider>
  )
}
