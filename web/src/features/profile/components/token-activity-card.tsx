import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { getMyUsage } from '@/features/usage-statistics/api'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

const DAY_MS = 86400 * 1000
const ACTIVITY_DAYS = 365
const COLORS = [
  'bg-muted',
  'bg-blue-200 dark:bg-blue-950',
  'bg-blue-300 dark:bg-blue-800',
  'bg-blue-500 dark:bg-blue-600',
  'bg-blue-700 dark:bg-blue-400',
]

async function loadTokenActivity(
  today: number,
  signal: AbortSignal
): Promise<Map<string, number>> {
  const firstDay = today - (ACTIVITY_DAYS - 1) * DAY_MS
  const ranges = []
  for (let start = firstDay; start <= today; start += 31 * DAY_MS) {
    ranges.push({
      start_timestamp: start / 1000,
      end_timestamp: Math.min(start + 31 * DAY_MS, today + DAY_MS) / 1000 - 1,
    })
  }

  const totals = new Map<string, number>()
  for (let index = 0; index < ranges.length; index += 3) {
    if (signal.aborted) throw signal.reason ?? new Error('Cancelled')
    const results = await Promise.allSettled(
      ranges.slice(index, index + 3).map(async (range) => {
        const result = await getMyUsage(range)
        if (!result.success) throw createServerError(result)
        if (!Array.isArray(result.data?.daily)) {
          throw new Error('Invalid usage data')
        }
        return result.data.daily
      })
    )
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      for (const day of result.value) totals.set(day.day, day.total_tokens)
    }
  }
  return totals
}

export function TokenActivityCard() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [today, setToday] = useState(
    () => Math.floor(Date.now() / DAY_MS) * DAY_MS
  )
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLTableElement>(null)
  const helpId = useId()

  useEffect(() => {
    const updateToday = () => setToday(Math.floor(Date.now() / DAY_MS) * DAY_MS)
    const timeout = window.setTimeout(
      updateToday,
      today + DAY_MS - Date.now() + 50
    )
    document.addEventListener('visibilitychange', updateToday)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', updateToday)
    }
  }, [today])

  const query = useQuery({
    queryKey: ['token-activity', userId, today],
    queryFn: ({ signal }) => loadTokenActivity(today, signal),
    enabled: userId != null,
    staleTime: 5 * 60 * 1000,
    meta: { errorToast: false },
  })

  useEffect(() => {
    if (query.data && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [query.data])

  const days = useMemo(() => {
    const dateFormatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
    return Array.from({ length: ACTIVITY_DAYS }, (_, index) => {
      const timestamp = today - (ACTIVITY_DAYS - 1 - index) * DAY_MS
      const date = new Date(timestamp)
      const tokens = query.data?.get(date.toISOString().slice(0, 10)) ?? 0
      return {
        timestamp,
        date,
        tokens,
        label: t('{{date}}: {{value}} tokens', {
          date: dateFormatter.format(date),
          value: formatNumber(tokens, locale),
        }),
      }
    })
  }, [query.data, today, locale, t])
  const firstWeekday = days[0].date.getUTCDay()
  const weekCount = Math.ceil((firstWeekday + days.length) / 7)
  const maximum = Math.max(...days.map((day) => day.tokens))
  const total = days.reduce((sum, day) => sum + day.tokens, 0)
  const selected =
    days.find((day) => day.timestamp === selectedDay) ?? days[ACTIVITY_DAYS - 1]
  const months = useMemo(() => {
    const monthFormatter = new Intl.DateTimeFormat(locale, {
      month: 'short',
      timeZone: 'UTC',
    })
    const labels = new Map<number, string>()
    days.forEach((day, index) => {
      if (index === 0 || day.date.getUTCDate() === 1) {
        labels.set(
          Math.floor((firstWeekday + index) / 7),
          monthFormatter.format(day.date)
        )
      }
    })
    return labels
  }, [days, firstWeekday, locale])

  return (
    <TitledCard
      title={t('Token Activity')}
      description={t(
        'Based on available usage logs; history may be incomplete. Dates use UTC.'
      )}
      icon={<Activity />}
    >
      {query.isError && (
        <ErrorState
          title={t('Failed to load usage details')}
          onRetry={() => query.refetch()}
          className='min-h-40'
        />
      )}
      {!query.isError && !query.data && <LoadingState className='min-h-40' />}
      {!query.isError && query.data && (
        <div className='space-y-4'>
          <dl className='flex flex-wrap gap-x-10 gap-y-3'>
            <div>
              <dt className='text-muted-foreground text-xs'>
                {t('Today (UTC)')}
              </dt>
              <dd className='text-lg font-semibold tabular-nums'>
                {formatNumber(days.at(-1)?.tokens, locale)}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground text-xs'>
                {t('Last 365 days')}
              </dt>
              <dd className='text-lg font-semibold tabular-nums'>
                {formatNumber(total, locale)}
              </dd>
            </div>
          </dl>

          <p id={helpId} className='sr-only'>
            {t('Use arrow keys to navigate the calendar.')}
          </p>
          <div
            ref={scrollRef}
            role='region'
            aria-label={t('Token activity calendar')}
            className='overflow-x-auto overflow-y-hidden'
          >
            <table
              ref={gridRef}
              role='grid'
              aria-label={t('Token activity calendar')}
              aria-describedby={helpId}
              className='table-fixed border-separate border-spacing-[3px]'
              style={{ width: weekCount * 17 + 3 }}
            >
              <thead>
                <tr>
                  {Array.from({ length: weekCount }, (_, week) => (
                    <th
                      key={week}
                      scope='col'
                      className='text-muted-foreground h-6 overflow-visible p-0 text-left text-xs font-normal whitespace-nowrap'
                    >
                      {months.get(week)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 7 }, (_, weekday) => (
                  <tr key={weekday}>
                    {Array.from({ length: weekCount }, (_, week) => {
                      const index = week * 7 + weekday - firstWeekday
                      const day = days[index]
                      if (!day) return <td key={week} className='p-0' />
                      const level =
                        day.tokens > 0 && maximum > 0
                          ? Math.ceil((day.tokens / maximum) * 4)
                          : 0
                      return (
                        <td
                          key={week}
                          aria-selected={day.timestamp === selected.timestamp}
                          className='p-0'
                        >
                          <Button
                            variant='default'
                            size='icon-xs'
                            aria-label={day.label}
                            aria-pressed={day.timestamp === selected.timestamp}
                            data-day={day.timestamp}
                            data-level={level}
                            title={day.label}
                            tabIndex={
                              day.timestamp === selected.timestamp ? 0 : -1
                            }
                            className={cn(
                              'size-[14px] rounded-[3px] border-0 p-0 hover:opacity-80 focus-visible:z-10 focus-visible:ring-2',
                              COLORS[level]
                            )}
                            onClick={() => setSelectedDay(day.timestamp)}
                            onFocus={() => setSelectedDay(day.timestamp)}
                            onKeyDown={(event) => {
                              const steps: Record<string, number> = {
                                ArrowLeft: -7,
                                ArrowRight: 7,
                                ArrowUp: -1,
                                ArrowDown: 1,
                              }
                              const step = steps[event.key]
                              if (step == null) return
                              event.preventDefault()
                              const next =
                                days[
                                  Math.max(
                                    0,
                                    Math.min(index + step, days.length - 1)
                                  )
                                ]
                              gridRef.current
                                ?.querySelector<HTMLButtonElement>(
                                  `[data-day="${next.timestamp}"]`
                                )
                                ?.focus()
                            }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-xs'>
            <p aria-live='polite'>{selected.label}</p>
            <div className='flex items-center gap-1' aria-hidden='true'>
              <span>{t('Less')}</span>
              {COLORS.map((color) => (
                <span
                  key={color}
                  className={cn('size-3 rounded-[3px]', color)}
                />
              ))}
              <span>{t('More')}</span>
            </div>
          </div>
        </div>
      )}
    </TitledCard>
  )
}
