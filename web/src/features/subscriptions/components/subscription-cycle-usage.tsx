import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getUserSubscriptionTokenUsage } from '../api'
import { formatTimestamp } from '../lib'

interface SubscriptionCycleUsageProps {
  userId: number
}

export function SubscriptionCycleUsage(props: SubscriptionCycleUsageProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userId = props.userId
  const usageQuery = useQuery({
    queryKey: ['subscription', 'admin', 'cycle-token-usage', userId],
    enabled: userId > 0,
    queryFn: async () => {
      const response = requireServerSuccess(
        await getUserSubscriptionTokenUsage(userId)
      )
      return response.data ?? []
    },
    staleTime: 15_000,
  })

  return (
    <div className='space-y-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='text-muted-foreground space-y-1 text-xs leading-relaxed'>
          <p>{t('Each paid purchase or renewal starts a new usage period.')}</p>
          <p>
            {t(
              'Only retained subscription consumption logs are counted. Wallet requests are excluded; cleared logs cannot be recovered.'
            )}
          </p>
        </div>
        <Button
          variant='outline'
          size='sm'
          disabled={usageQuery.isFetching}
          onClick={() => usageQuery.refetch()}
        >
          <RefreshCw aria-hidden='true' />
          {t('Refresh')}
        </Button>
      </div>
      {usageQuery.isLoading && <Skeleton className='h-40 w-full' />}
      {usageQuery.isError && (
        <ErrorState
          title={t('Failed to load usage details')}
          onRetry={() => usageQuery.refetch()}
          className='min-h-40'
        />
      )}
      {!usageQuery.isLoading && !usageQuery.isError && (
        <StaticDataTable
          data={usageQuery.data ?? []}
          getRowKey={(period) => `${period.subscription_id}:${period.cycle}`}
          emptyContent={t('No subscription records')}
          tableClassName='min-w-max'
          columns={[
            {
              id: 'period',
              header: t('Period'),
              cell: (period) => (
                <div className='min-w-52 space-y-1'>
                  <p className='font-medium'>
                    {period.plan_title || `#${period.plan_id}`}
                    <span className='text-muted-foreground ml-2 text-xs'>
                      #{period.subscription_id} ·{' '}
                      {t('Cycle {{number}}', { number: period.cycle })}
                    </span>
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {formatTimestamp(period.start_time)}
                    <span className='mx-1'>–</span>
                    {formatTimestamp(period.end_time)}
                  </p>
                </div>
              ),
            },
            {
              id: 'requests',
              header: t('Requests'),
              cell: (period) => formatNumber(period.request_count, locale),
            },
            {
              id: 'input',
              header: t('Input tokens'),
              cell: (period) => formatNumber(period.input_tokens, locale),
            },
            {
              id: 'output',
              header: t('Output tokens'),
              cell: (period) => formatNumber(period.output_tokens, locale),
            },
            {
              id: 'cache-read',
              header: t('Cache Read'),
              cell: (period) => formatNumber(period.cache_read_tokens, locale),
            },
            {
              id: 'cache-write',
              header: t('Cache Write'),
              cell: (period) => formatNumber(period.cache_write_tokens, locale),
            },
            {
              id: 'total',
              header: t('Total tokens'),
              cell: (period) => (
                <span className='font-semibold tabular-nums'>
                  {formatNumber(period.total_tokens, locale)}
                </span>
              ),
            },
          ]}
        />
      )}
      <p className='text-muted-foreground text-xs leading-relaxed'>
        {t(
          'Input plus output tokens from consumption logs. Cache reads and writes are included in input; reasoning is included in output. Refunds change spend, not token totals.'
        )}
      </p>
    </div>
  )
}
