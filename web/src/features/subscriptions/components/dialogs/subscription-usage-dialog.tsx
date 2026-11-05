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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ReceiptText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  getSelfSubscriptionUsage,
  getSelfSubscriptionUsageStatistics,
} from '../../api'
import type {
  SubscriptionUsageRecordFilters,
  SubscriptionUsageStatistics,
} from '../../types'
import { SubscriptionUsageFilters } from '../subscription-usage-filters'
import { SubscriptionUsageRecordCard } from '../subscription-usage-record-card'
import { SubscriptionUsageSummary } from '../subscription-usage-summary'

const PAGE_SIZE = 10
const skeletonKeys = ['one', 'two', 'three', 'four', 'five']

interface SubscriptionUsageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SubscriptionUsageDialog(props: SubscriptionUsageDialogProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<SubscriptionUsageRecordFilters>({})

  useEffect(() => {
    if (props.open) {
      setPage(1)
      setFilters({})
    }
  }, [props.open])

  const statisticsQuery = useQuery({
    queryKey: ['subscription', 'self', 'usage', 'statistics'],
    queryFn: async () => {
      const response = requireServerSuccess(
        await getSelfSubscriptionUsageStatistics()
      )
      return response.data as SubscriptionUsageStatistics
    },
    enabled: props.open,
    staleTime: 15 * 1000,
  })

  const usageQuery = useQuery({
    queryKey: ['subscription', 'self', 'usage', page, filters],
    queryFn: async () => {
      const response = requireServerSuccess(
        await getSelfSubscriptionUsage(page, PAGE_SIZE, filters)
      )
      return (
        response.data ?? {
          page,
          page_size: PAGE_SIZE,
          total: 0,
          items: [],
        }
      )
    },
    enabled: props.open,
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
  })

  const records = usageQuery.data?.items ?? []
  const total = usageQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters =
    filters.modelName != null ||
    filters.subscriptionId != null ||
    filters.tokenId != null ||
    filters.channelId != null

  function selectFilters(nextFilters: SubscriptionUsageRecordFilters) {
    setFilters(nextFilters)
    setPage(1)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Subscription Usage')}
      description={t(
        'Track wallet and subscription usage, refunds, and settlement.'
      )}
      contentClassName='sm:max-w-5xl'
      bodyClassName='space-y-4'
    >
      {statisticsQuery.isError && !statisticsQuery.data ? (
        <div className='border-destructive/30 bg-destructive/5 flex items-center justify-between gap-3 rounded-lg border px-3 py-2'>
          <span className='text-muted-foreground text-sm'>
            {t('Failed to load usage statistics')}
          </span>
          <Button
            variant='outline'
            size='sm'
            onClick={() => statisticsQuery.refetch()}
          >
            {t('Retry')}
          </Button>
        </div>
      ) : (
        <SubscriptionUsageSummary
          statistics={statisticsQuery.data}
          loading={statisticsQuery.isLoading}
        />
      )}

      {statisticsQuery.data?.filter_options && (
        <SubscriptionUsageFilters
          filters={filters}
          options={statisticsQuery.data.filter_options}
          onChange={selectFilters}
        />
      )}

      <section className='space-y-3 border-t pt-4'>
        <div className='flex items-center justify-between gap-2'>
          <h3 className='text-sm font-medium'>{t('Usage Records')}</h3>
          {usageQuery.isFetching && !usageQuery.isLoading && (
            <span className='text-muted-foreground text-xs'>
              {t('Loading...')}
            </span>
          )}
        </div>

        {usageQuery.isLoading && (
          <div className='space-y-3'>
            {skeletonKeys.map((key) => (
              <div key={key} className='rounded-lg border p-3 sm:p-4'>
                <div className='flex items-start justify-between gap-3'>
                  <div className='space-y-2'>
                    <Skeleton className='h-4 w-40' />
                    <Skeleton className='h-3 w-28' />
                  </div>
                  <Skeleton className='h-8 w-20' />
                </div>
                <Skeleton className='mt-3 h-3 w-56' />
              </div>
            ))}
          </div>
        )}
        {!usageQuery.isLoading &&
          usageQuery.isError &&
          records.length === 0 && (
            <div className='flex flex-col items-center gap-3 py-12 text-center'>
              <p className='text-muted-foreground text-sm'>
                {t('Failed to load')}
              </p>
              <Button
                variant='outline'
                size='sm'
                onClick={() => usageQuery.refetch()}
              >
                {t('Retry')}
              </Button>
            </div>
          )}
        {!usageQuery.isLoading &&
          !usageQuery.isError &&
          records.length === 0 && (
            <EmptyState
              icon={ReceiptText}
              title={
                hasFilters
                  ? t('No matching usage records')
                  : t('No subscription usage records')
              }
              description={
                hasFilters
                  ? t(
                      'Try adjusting the filters or clear them to see all usage.'
                    )
                  : t(
                      'Usage will appear here after a request is billed to a subscription.'
                    )
              }
              action={
                hasFilters ? (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => selectFilters({})}
                  >
                    {t('Clear filters')}
                  </Button>
                ) : undefined
              }
              className='min-h-56'
            />
          )}
        {!usageQuery.isLoading && records.length > 0 && (
          <>
            <div className='max-h-[min(48vh,480px)] space-y-3 overflow-y-auto pr-1'>
              {records.map((record) => (
                <SubscriptionUsageRecordCard
                  key={record.billing_id}
                  record={record}
                  locale={locale}
                />
              ))}
            </div>
            <div className='flex flex-col items-center gap-3 border-t pt-4 sm:flex-row sm:justify-between'>
              <div className='text-muted-foreground text-xs sm:text-sm'>
                {t('Showing')} {(page - 1) * PAGE_SIZE + 1}-
                {Math.min(page * PAGE_SIZE, total)} {t('of')} {total}
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setPage((current) => current - 1)}
                  disabled={page <= 1}
                  className='h-8 w-8 p-0'
                  aria-label={t('Previous')}
                >
                  <ChevronLeft className='h-4 w-4' />
                </Button>
                <div className='text-muted-foreground flex items-center gap-1 text-sm'>
                  <span className='font-medium'>{page}</span>
                  <span>/</span>
                  <span>{totalPages}</span>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setPage((current) => current + 1)}
                  disabled={page >= totalPages}
                  className='h-8 w-8 p-0'
                  aria-label={t('Next')}
                >
                  <ChevronRight className='h-4 w-4' />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </Dialog>
  )
}
