import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Input } from '@/components/ui/input'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { dateToUnixTimestamp } from '@/lib/time'

import { getSubscriptionOverview } from './api'
import { SubscriptionOverviewCards } from './components/overview-cards'
import { PlanBreakdown } from './components/plan-breakdown'
import type { SubscriptionOverviewParams } from './types'

const MAX_RANGE_DAYS = 366
const DEFAULT_UPSTREAM_RATIO = 0.15

export function SubscriptionDashboard() {
  const { t } = useTranslation()
  const [range, setRange] = useState(() => ({
    start: dayjs().subtract(29, 'day').startOf('day').toDate(),
    end: new Date(),
  }))
  const [ratioText, setRatioText] = useState(String(DEFAULT_UPSTREAM_RATIO))
  const [upstreamRatio, setUpstreamRatio] = useState(DEFAULT_UPSTREAM_RATIO)

  const params = useMemo<SubscriptionOverviewParams>(
    () => ({
      start_timestamp: dateToUnixTimestamp(range.start),
      end_timestamp: dateToUnixTimestamp(range.end),
      upstream_ratio: upstreamRatio,
    }),
    [range, upstreamRatio]
  )

  const overviewQuery = useQuery({
    queryKey: ['subscription-dashboard', params],
    queryFn: async () => {
      const result = await getSubscriptionOverview(params)
      if (!result.success || !result.data) {
        throw new Error(
          result.message || t('Failed to load subscription business overview')
        )
      }
      return result.data
    },
    staleTime: 30_000,
  })

  const handleRangeChange = (nextRange: { start?: Date; end?: Date }) => {
    if (!nextRange.start || !nextRange.end) return
    const rangeSeconds =
      dateToUnixTimestamp(nextRange.end) - dateToUnixTimestamp(nextRange.start)
    if (rangeSeconds < 0 || rangeSeconds > MAX_RANGE_DAYS * 86400) {
      toast.error(
        t('Date range cannot exceed {{days}} days', { days: MAX_RANGE_DAYS })
      )
      return
    }
    setRange({ start: nextRange.start, end: nextRange.end })
  }

  const commitUpstreamRatio = () => {
    const next = Number.parseFloat(ratioText)
    if (!Number.isFinite(next) || next < 0 || next > 100) {
      toast.error(t('Invalid upstream ratio'))
      setRatioText(String(upstreamRatio))
      return
    }
    setUpstreamRatio(next)
  }

  const overview = overviewQuery.data

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Subscription Business')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex flex-wrap items-center gap-2'>
          <div className='flex items-center gap-2'>
            <span className='text-muted-foreground text-xs whitespace-nowrap'>
              {t('Upstream ratio')}
            </span>
            <Input
              aria-label={t('Upstream ratio')}
              inputMode='decimal'
              value={ratioText}
              onChange={(event) => setRatioText(event.target.value)}
              onBlur={commitUpstreamRatio}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
              className='h-8 w-20'
            />
          </div>
          <CompactDateTimeRangePicker
            start={range.start}
            end={range.end}
            onChange={handleRangeChange}
            maxRangeDays={MAX_RANGE_DAYS}
            className='w-full sm:w-80'
          />
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-7xl space-y-4'>
          {overviewQuery.isError ? (
            <ErrorState
              title={t('Failed to load subscription business overview')}
              description={
                overviewQuery.error instanceof Error
                  ? overviewQuery.error.message
                  : undefined
              }
              onRetry={() => overviewQuery.refetch()}
            />
          ) : (
            <>
              <SubscriptionOverviewCards
                summary={overview?.summary}
                loading={overviewQuery.isLoading}
              />
              <PlanBreakdown
                plans={overview?.plans}
                loading={overviewQuery.isLoading}
              />
              <div className='text-muted-foreground space-y-1 text-xs'>
                <p>
                  {t(
                    'Amounts follow the current custom currency display. Subscription orders are prepaid, so cash profit looks high early because unused quota has no upstream cost.'
                  )}
                </p>
                <p>
                  {t(
                    'Remaining cost exposure = remaining quota × upstream ratio.'
                  )}
                </p>
              </div>
            </>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
