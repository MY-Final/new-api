import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight, Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import { getSubscriptionPlanSubscribers } from '../api'
import type {
  SubscriberStatusFilter,
  SubscriptionOverviewPlan,
  SubscriptionPlanSubscriber,
} from '../types'

interface PlanSubscribersDialogProps {
  plan: SubscriptionOverviewPlan | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PAGE_SIZE = 15

function statusBadgeVariant(status: string): StatusVariant {
  switch (status) {
    case 'active':
      return 'success'
    case 'cancelled':
      return 'danger'
    default:
      return 'neutral'
  }
}

function statusLabel(
  t: ReturnType<typeof useTranslation>['t'],
  status: string
): string {
  switch (status) {
    case 'active':
      return t('Active')
    case 'cancelled':
      return t('Cancelled')
    default:
      return t('Expired')
  }
}

function sourceLabel(
  t: ReturnType<typeof useTranslation>['t'],
  source: string
): string {
  return source === 'admin' ? t('Admin') : t('Order')
}

function formatUnixDateTime(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return '—'
  return dayjs.unix(timestamp).format('YYYY-MM-DD HH:mm')
}

function SubscriberQuotaCell(props: {
  subscriber: SubscriptionPlanSubscriber
}) {
  const { t } = useTranslation()
  const sub = props.subscriber
  if (sub.amount_total <= 0) {
    return (
      <div className='flex flex-col items-end gap-0.5 tabular-nums'>
        <span className='text-xs font-medium'>{t('Unlimited')}</span>
        <span className='text-muted-foreground text-[11px]'>
          {t('Used')}: {formatQuota(sub.amount_used)}
        </span>
      </div>
    )
  }

  const totalUsed = sub.amount_used + sub.amount_reserved
  const pct = Math.min(100, Math.max(0, (totalUsed / sub.amount_total) * 100))

  return (
    <div className='flex min-w-36 flex-col items-end gap-1 tabular-nums'>
      <div className='text-xs'>
        <span className='font-medium'>{formatQuota(sub.amount_used)}</span>
        <span className='text-muted-foreground'>
          {' '}
          / {formatQuota(sub.amount_total)}
        </span>
      </div>
      <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
        <div
          className='bg-primary h-full rounded-full transition-all'
          style={{ width: `${pct}%` }}
        />
      </div>
      {sub.amount_reserved > 0 && (
        <span className='text-muted-foreground text-[11px]'>
          {t('In progress')}: {formatQuota(sub.amount_reserved)}
        </span>
      )}
    </div>
  )
}

export function PlanSubscribersDialog(props: PlanSubscribersDialogProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const plan = props.plan
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] =
    useState<SubscriberStatusFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    setPage(1)
    setStatusFilter('all')
    setSearchInput('')
    setKeyword('')
  }, [plan?.plan_id])

  const subscribersQuery = useQuery({
    queryKey: [
      'subscription-plan-subscribers',
      plan?.plan_id,
      page,
      statusFilter,
      keyword,
    ],
    enabled: props.open && plan !== null,
    queryFn: async () => {
      if (!plan) {
        throw new Error('Missing plan')
      }
      const result = await getSubscriptionPlanSubscribers(plan.plan_id, {
        page,
        page_size: PAGE_SIZE,
        status: statusFilter === 'all' ? undefined : statusFilter,
        keyword: keyword.trim() || undefined,
      })
      if (!result.success || !result.data) {
        throw new Error(result.message || t('Failed to load subscribers'))
      }
      return result.data
    },
    staleTime: 15_000,
  })

  const data = subscribersQuery.data
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setKeyword(searchInput.trim())
  }

  let listContent: React.ReactNode
  if (subscribersQuery.isLoading) {
    listContent = (
      <LoadingState
        message={t('Loading subscribers...')}
        className='min-h-48'
      />
    )
  } else if (subscribersQuery.isError) {
    listContent = (
      <ErrorState
        title={t('Failed to load subscribers')}
        description={
          subscribersQuery.error instanceof Error
            ? subscribersQuery.error.message
            : undefined
        }
        onRetry={() => subscribersQuery.refetch()}
      />
    )
  } else if (items.length === 0) {
    listContent = (
      <EmptyState
        icon={Users}
        title={t('No subscribers found')}
        description={t('No users match the current plan or filter criteria.')}
      />
    )
  } else {
    listContent = (
      <div className='overflow-x-auto rounded-xl border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('User')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead>{t('Source')}</TableHead>
              <TableHead className='text-right'>{t('Quota usage')}</TableHead>
              <TableHead>{t('Validity period')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell>
                  <div className='flex flex-col gap-0.5'>
                    <span className='font-medium'>
                      {sub.display_name || sub.username || `#${sub.user_id}`}
                    </span>
                    <span className='text-muted-foreground text-xs'>
                      @{sub.username || '—'} · #{sub.user_id}
                      {sub.email ? ` · ${sub.email}` : ''}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge variant={statusBadgeVariant(sub.effective_status)}>
                    {statusLabel(t, sub.effective_status)}
                  </StatusBadge>
                </TableCell>
                <TableCell className='text-muted-foreground text-xs'>
                  {sourceLabel(t, sub.source)}
                </TableCell>
                <TableCell className='text-right'>
                  <SubscriberQuotaCell subscriber={sub} />
                </TableCell>
                <TableCell className='text-muted-foreground text-xs whitespace-nowrap tabular-nums'>
                  <div>{formatUnixDateTime(sub.start_time)}</div>
                  <div>→ {formatUnixDateTime(sub.end_time)}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        plan
          ? t('{{plan}} — Subscribers', { plan: plan.title })
          : t('Subscribers')
      }
      description={
        data
          ? t('{{total}} records ({{active}} active)', {
              total: formatNumber(data.total, locale),
              active: formatNumber(data.active_count, locale),
            })
          : t('View users subscribed to this plan and their quota usage.')
      }
      contentClassName='sm:max-w-4xl'
    >
      <div className='space-y-4'>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
          <form
            onSubmit={handleSearchSubmit}
            className='flex flex-1 items-center gap-2'
          >
            <div className='relative flex-1 sm:max-w-xs'>
              <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('Search username, email, or user ID')}
                className='pl-8'
              />
            </div>
            <Button type='submit' variant='outline' size='sm'>
              {t('Search')}
            </Button>
          </form>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setPage(1)
              setStatusFilter((value as SubscriberStatusFilter) || 'all')
            }}
          >
            <SelectTrigger className='w-full sm:w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>{t('All statuses')}</SelectItem>
              <SelectItem value='active'>{t('Active')}</SelectItem>
              <SelectItem value='expired'>{t('Expired')}</SelectItem>
              <SelectItem value='cancelled'>{t('Cancelled')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {listContent}

        {total > PAGE_SIZE && (
          <div className='flex items-center justify-between text-xs'>
            <span className='text-muted-foreground'>
              {t('Page {{page}} of {{total}}', {
                page: formatNumber(page, locale),
                total: formatNumber(totalPages, locale),
              })}
            </span>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className='size-4' />
                {t('Previous')}
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t('Next')}
                <ChevronRight className='size-4' />
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
