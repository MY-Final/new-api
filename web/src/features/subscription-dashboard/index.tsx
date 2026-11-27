import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { AlertTriangle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { formatQuota } from '@/lib/format'
import { dateToUnixTimestamp } from '@/lib/time'

import { getSubscriptionOverview } from './api'
import { SubscriptionOverviewCards } from './components/overview-cards'
import { PlanBreakdown } from './components/plan-breakdown'
import type { SubscriptionOverviewParams } from './types'

const MAX_RANGE_DAYS = 366

export function SubscriptionDashboard() {
  const { t } = useTranslation()
  const [range, setRange] = useState(() => ({
    start: dayjs().subtract(29, 'day').startOf('day').toDate(),
    end: new Date(),
  }))
  const params = useMemo<SubscriptionOverviewParams>(
    () => ({
      start_timestamp: dateToUnixTimestamp(range.start),
      end_timestamp: dateToUnixTimestamp(range.end),
    }),
    [range]
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

  const overview = overviewQuery.data
  const belowPricePlans =
    overview?.plans.filter((plan) => plan.quota_below_price) ?? []
  const unattributedQuota = overview?.summary.unattributed_quota ?? 0

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Subscription Business')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <CompactDateTimeRangePicker
          start={range.start}
          end={range.end}
          onChange={handleRangeChange}
          maxRangeDays={MAX_RANGE_DAYS}
          className='w-full sm:w-80'
        />
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
              {overview?.has_unsupported_currency && (
                <Alert variant='destructive'>
                  <AlertTriangle />
                  <AlertTitle>
                    {t('Unsupported currency in subscription orders')}
                  </AlertTitle>
                  <AlertDescription>
                    {t(
                      'Some subscription orders use a currency that cannot be converted to USD. Their revenue is excluded from totals.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {unattributedQuota > 0 && (
                <Alert className='border-warning/40 text-warning [&_[data-slot=alert-description]]:text-warning/80'>
                  <AlertTriangle />
                  <AlertTitle>{t('Unattributed subscription cost')}</AlertTitle>
                  <AlertDescription>
                    {t(
                      'Some settled subscription usage has no snapshotted upstream cost ratio. {{quota}} of consumed quota is excluded from cost and profit.',
                      { quota: formatQuota(unattributedQuota) }
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {belowPricePlans.length > 0 && (
                <Alert className='border-warning/40 text-warning [&_[data-slot=alert-description]]:text-warning/80'>
                  <AlertTriangle />
                  <AlertTitle>
                    {t('Quota value is below plan price')}
                  </AlertTitle>
                  <AlertDescription>
                    {t(
                      'At the current exchange rate, the configured quota is worth less than the plan price for: {{plans}}.',
                      {
                        plans: belowPricePlans
                          .map((plan) => plan.title)
                          .join(', '),
                      }
                    )}
                  </AlertDescription>
                </Alert>
              )}
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
                    'Amounts are calculated in USD and displayed in the site display currency.'
                  )}
                </p>
                <p>
                  {t(
                    'Total revenue includes balance purchases; cash revenue only counts external payments.'
                  )}
                </p>
                <p>
                  {t(
                    'Consumed cost uses each settled request’s route group and the cost ratio snapshotted with the subscription.'
                  )}
                </p>
                <p>
                  {t(
                    'Costs use only snapshotted upstream cost ratios. Usage without a snapshot is shown as unattributed and excluded.'
                  )}
                </p>
                <p>
                  {t(
                    'Remaining cost exposure = remaining quota × remaining cost ratio.'
                  )}
                </p>
                <p>
                  {t(
                    'The date range filters order revenue and consumed quota. Active subscriptions and remaining quota are a current snapshot.'
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
