import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { getAffiliateRebates } from '@/features/wallet/api'
import { formatQuotaPrecise, formatTimestampToDate } from '@/lib/format'

const pageSize = 20

function sourceLabel(source: string, t: (key: string) => string) {
  if (source === 'all') return t('All sources')
  if (source === 'signup') return t('Registration')
  if (source === 'topup') return t('Top-up')
  if (source === 'redemption') return t('Redemption code')
  return source
}

function statusLabel(status: string, t: (key: string) => string) {
  if (status === 'all') return t('All statuses')
  if (status === 'settled') return t('Settled')
  if (status === 'reversed') return t('Reversed')
  return status
}

export function AffiliateRebates() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [sourceType, setSourceType] = useState('all')
  const [status, setStatus] = useState('all')
  const [range, setRange] = useState<{ start?: Date; end?: Date }>({})
  const { data, isLoading } = useQuery({
    queryKey: ['personal-affiliate-rebates', page, sourceType, status, range],
    queryFn: async () => {
      const response = await getAffiliateRebates(
        page,
        pageSize,
        sourceType === 'all' ? undefined : sourceType,
        {
          status: status === 'all' ? undefined : status,
          startTime: range.start
            ? Math.floor(range.start.getTime() / 1000)
            : undefined,
          endTime: range.end
            ? Math.floor(range.end.getTime() / 1000)
            : undefined,
        }
      )
      return {
        total: response.data?.total || 0,
        items: response.data?.items || [],
      }
    },
  })
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize))

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Affiliate Rebates')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-7xl space-y-4'>
          <div className='flex flex-col gap-2 sm:flex-row sm:flex-wrap'>
            <Select
              value={sourceType}
              onValueChange={(value) => {
                setSourceType(value || 'all')
                setPage(1)
              }}
            >
              <SelectTrigger className='w-full sm:w-44'>
                <SelectValue>{sourceLabel(sourceType, t)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>{t('All sources')}</SelectItem>
                <SelectItem value='signup'>{t('Registration')}</SelectItem>
                <SelectItem value='topup'>{t('Top-up')}</SelectItem>
                <SelectItem value='redemption'>
                  {t('Redemption code')}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value || 'all')
                setPage(1)
              }}
            >
              <SelectTrigger className='w-full sm:w-40'>
                <SelectValue>{statusLabel(status, t)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>{t('All statuses')}</SelectItem>
                <SelectItem value='settled'>{t('Settled')}</SelectItem>
                <SelectItem value='reversed'>{t('Reversed')}</SelectItem>
              </SelectContent>
            </Select>
            <CompactDateTimeRangePicker
              start={range.start}
              end={range.end}
              onChange={(value) => {
                setRange(value)
                setPage(1)
              }}
              className='sm:w-80'
            />
          </div>
          <div className='space-y-2'>
            {isLoading ? (
              <p className='text-muted-foreground py-12 text-center text-sm'>
                {t('Loading...')}
              </p>
            ) : null}
            {!isLoading && !data?.items.length ? (
              <p className='text-muted-foreground py-12 text-center text-sm'>
                {t('No referral rebates found')}
              </p>
            ) : null}
            {data?.items.map((item) => (
              <Card key={item.id} data-card-hover='false'>
                <CardContent className='grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center'>
                  <div className='min-w-0'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-medium'>
                        {sourceLabel(item.source_type, t)}
                      </span>
                      <Badge
                        variant={
                          item.status === 'reversed'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {t(item.status === 'reversed' ? 'Reversed' : 'Settled')}
                      </Badge>
                      <span className='text-muted-foreground text-xs'>
                        #{item.source_id}
                      </span>
                    </div>
                    <div className='text-muted-foreground mt-1 text-xs'>
                      {item.invitee_username ||
                        `${t('User ID')}: ${item.invitee_id}`}{' '}
                      · {formatTimestampToDate(item.created_at)}
                    </div>
                    {item.reverse_reason ? (
                      <div className='text-muted-foreground mt-1 text-xs'>
                        {t('Reason')}: {item.reverse_reason}
                      </div>
                    ) : null}
                  </div>
                  <div className='text-left sm:text-right'>
                    <div className='font-semibold tabular-nums'>
                      +{formatQuotaPrecise(item.rebate_quota)}
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      {t('Base quota')}: {formatQuotaPrecise(item.base_quota)} ·{' '}
                      {item.rate / 100}%
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      {t('Transferred')}:{' '}
                      {formatQuotaPrecise(item.transferred_quota)} ·{' '}
                      {t('Reversed')}: {formatQuotaPrecise(item.reversed_quota)}
                    </div>
                    {item.debt_offset_quota > 0 ? (
                      <div className='text-warning text-xs'>
                        {t('Debt settled')}:{' '}
                        {formatQuotaPrecise(item.debt_offset_quota)}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-sm'>
              {t('Page {{page}} of {{totalPages}}', { page, totalPages })}
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                {t('Previous')}
              </Button>
              <Button
                variant='outline'
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                {t('Next')}
              </Button>
            </div>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
