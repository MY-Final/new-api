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

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getSelfSubscriptionUsage } from '../../api'
import type { SubscriptionUsageRecord } from '../../types'

const PAGE_SIZE = 10
const skeletonKeys = ['one', 'two', 'three', 'four', 'five']

interface SubscriptionUsageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function SubscriptionUsageRecordCard(props: {
  record: SubscriptionUsageRecord
  locale?: string
}) {
  const { t } = useTranslation()
  const record = props.record
  const planLabel = record.plan_title || t('Subscription')

  return (
    <div className='rounded-lg border p-3 sm:p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 space-y-1'>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <span className='truncate text-sm font-medium'>
              {record.model_name || '-'}
            </span>
            {record.refunded_quota > 0 && (
              <StatusBadge
                label={t('Refunded')}
                variant='neutral'
                size='sm'
                copyable={false}
              />
            )}
          </div>
          <div className='text-muted-foreground text-xs'>
            {planLabel} · {t('Subscription')} #{record.subscription_id}
          </div>
        </div>
        <div className='shrink-0 text-right'>
          <div className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
            {t('Consumed Quota')}
          </div>
          <div className='mt-1 font-mono text-sm font-semibold tabular-nums sm:text-base'>
            {formatQuota(record.quota)}
          </div>
        </div>
      </div>
      <div className='text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
        <span>
          {new Date(record.created_at * 1000).toLocaleString(props.locale)}
        </span>
        <span className='flex min-w-0 items-center gap-1'>
          <span>{t('Request ID')}:</span>
          <code className='text-foreground max-w-52 truncate font-mono'>
            {record.request_id}
          </code>
          <CopyButton
            value={record.request_id}
            size='sm'
            className='h-5 w-5 p-0'
            iconClassName='h-3 w-3'
          />
        </span>
      </div>
    </div>
  )
}

export function SubscriptionUsageDialog(props: SubscriptionUsageDialogProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (props.open) {
      setPage(1)
    }
  }, [props.open])

  const usageQuery = useQuery({
    queryKey: ['subscription', 'self', 'usage', page],
    queryFn: async () => {
      const response = requireServerSuccess(
        await getSelfSubscriptionUsage(page, PAGE_SIZE)
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

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Subscription Usage')}
      description={t(
        'Requests billed to a subscription are shown using the net charged amount.'
      )}
      contentClassName='sm:max-w-3xl'
      bodyClassName='space-y-3'
    >
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
      {!usageQuery.isLoading && usageQuery.isError && records.length === 0 && (
        <div className='flex flex-col items-center gap-3 py-12 text-center'>
          <p className='text-muted-foreground text-sm'>{t('Failed to load')}</p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => usageQuery.refetch()}
          >
            {t('Retry')}
          </Button>
        </div>
      )}
      {!usageQuery.isLoading && !usageQuery.isError && records.length === 0 && (
        <EmptyState
          icon={ReceiptText}
          title={t('No subscription usage records')}
          description={t(
            'Usage will appear here after a request is billed to a subscription.'
          )}
          className='min-h-56'
        />
      )}
      {!usageQuery.isLoading && records.length > 0 && (
        <>
          <div className='max-h-[min(56vh,540px)] space-y-3 overflow-y-auto pr-1'>
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
    </Dialog>
  )
}
