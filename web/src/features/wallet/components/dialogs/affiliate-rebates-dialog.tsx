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
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsAdmin } from '@/hooks/use-admin'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import {
  getAffiliateRebates,
  getAllAffiliateRebates,
  isApiSuccess,
  reverseAffiliateRebate,
} from '../../api'
import type { AffiliateRebate, AffiliateRebateSource } from '../../types'

interface AffiliateRebatesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const sourceLabels: Record<AffiliateRebateSource, string> = {
  signup: 'Registration',
  topup: 'Top-up',
  redemption: 'Redemption code',
}

type SourceFilter = AffiliateRebateSource | 'all'

const skeletonKeys = ['one', 'two', 'three', 'four']

function sourceLabel(
  source: AffiliateRebateSource,
  t: (key: string) => string
) {
  return t(sourceLabels[source])
}

function RebateRow({
  rebate,
  isAdmin,
  onReverse,
}: {
  rebate: AffiliateRebate
  isAdmin: boolean
  onReverse: (rebate: AffiliateRebate) => void
}) {
  const { t } = useTranslation()
  const statusLabel =
    rebate.status === 'reversed' ? t('Reversed') : t('Settled')
  return (
    <div className='rounded-lg border p-3'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-sm font-medium'>
              {sourceLabel(rebate.source_type, t)}
            </span>
            <StatusBadge
              label={statusLabel}
              variant={rebate.status === 'reversed' ? 'danger' : 'success'}
              copyable={false}
              size='sm'
            />
          </div>
          <div className='text-muted-foreground mt-1 text-xs'>
            {t('Invitee')}: {rebate.invitee_username || rebate.invitee_id}
          </div>
          {isAdmin ? (
            <div className='text-muted-foreground mt-1 text-xs'>
              {t('Inviter')}: {rebate.inviter_username || rebate.inviter_id}
            </div>
          ) : null}
          <div className='text-muted-foreground mt-1 truncate font-mono text-xs'>
            {t('Source')}: {rebate.source_id}
          </div>
        </div>
        <div className='shrink-0 text-right'>
          <div className='text-sm font-semibold tabular-nums'>
            {formatQuota(rebate.rebate_quota)}
          </div>
          <div className='text-muted-foreground text-xs'>
            {t('{{rate}}% of {{quota}}', {
              rate: rebate.rate / 100,
              quota: formatQuota(rebate.base_quota),
            })}
          </div>
        </div>
      </div>
      <div className='text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs'>
        <span>{formatTimestampToDate(rebate.created_at)}</span>
        {rebate.transferred_quota > 0 ? (
          <span>
            {t('Transferred')}: {formatQuota(rebate.transferred_quota)}
          </span>
        ) : null}
        {rebate.reversed_quota > 0 ? (
          <span>
            {t('Reversed')}: {formatQuota(rebate.reversed_quota)}
          </span>
        ) : null}
        {isAdmin &&
        rebate.source_type === 'redemption' &&
        rebate.status === 'settled' ? (
          <Button
            variant='ghost'
            size='sm'
            className='h-6 px-2 text-xs'
            onClick={() => onReverse(rebate)}
          >
            <RotateCcw className='mr-1 size-3' />
            {t('Reverse')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function RebateList({
  loading,
  rebates,
  isAdmin,
  onReverse,
}: {
  loading: boolean
  rebates: AffiliateRebate[]
  isAdmin: boolean
  onReverse: (rebate: AffiliateRebate) => void
}) {
  const { t } = useTranslation()
  if (loading) {
    return (
      <div className='space-y-3'>
        {skeletonKeys.map((key) => (
          <Skeleton key={key} className='h-24 rounded-lg' />
        ))}
      </div>
    )
  }
  if (rebates.length === 0) {
    return (
      <div className='text-muted-foreground flex min-h-40 items-center justify-center text-sm'>
        {t('No referral rebates found')}
      </div>
    )
  }
  return (
    <div className='max-h-[min(60vh,560px)] space-y-3 overflow-y-auto pr-1'>
      {rebates.map((rebate) => (
        <RebateRow
          key={rebate.id}
          rebate={rebate}
          isAdmin={isAdmin}
          onReverse={onReverse}
        />
      ))}
    </div>
  )
}

export function AffiliateRebatesDialog({
  open,
  onOpenChange,
}: AffiliateRebatesDialogProps) {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const [rebates, setRebates] = useState<AffiliateRebate[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [reverseTarget, setReverseTarget] = useState<AffiliateRebate | null>(
    null
  )
  const [reverseReason, setReverseReason] = useState('')
  const [reversing, setReversing] = useState(false)
  const pageSize = 10

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const sourceType = sourceFilter === 'all' ? undefined : sourceFilter
    const request = isAdmin
      ? getAllAffiliateRebates(page, pageSize, sourceType)
      : getAffiliateRebates(page, pageSize, sourceType)
    void request
      .then((response) => {
        if (cancelled) return
        setRebates(response.data?.items ?? [])
        setTotal(response.data?.total ?? 0)
      })
      .catch((error: unknown) => {
        if (!cancelled) handleServerError(error)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin, open, page, sourceFilter])

  const handleSourceFilterChange = (value: string | null) => {
    if (!value) return
    setSourceFilter(value as SourceFilter)
    setPage(1)
  }

  const handleConfirmReverse = async () => {
    if (!reverseTarget) return
    setReversing(true)
    try {
      const response = await reverseAffiliateRebate({
        rebate_id: reverseTarget.id,
        reason: reverseReason.trim(),
      })
      if (!isApiSuccess(response)) {
        toast.error(response.message || t('Failed to reverse referral rebate'))
        return
      }
      setRebates((current) =>
        current.map((rebate) =>
          rebate.id === reverseTarget.id
            ? {
                ...rebate,
                status: 'reversed',
                reversed_quota: rebate.rebate_quota,
                reversed_at: Math.floor(Date.now() / 1000),
                reverse_reason: reverseReason.trim(),
              }
            : rebate
        )
      )
      setReverseTarget(null)
      setReverseReason('')
      toast.success(t('Referral rebate reversed'))
    } catch (error: unknown) {
      handleServerError(error)
    } finally {
      setReversing(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Referral Rebate Ledger')}
      description={t(
        isAdmin
          ? 'Review all referral rebates and reverse paid-code rebates when refunds are confirmed.'
          : 'Review your referral rebate sources and settlement status.'
      )}
      contentClassName='max-h-[calc(100dvh-2rem)] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-2xl'
      bodyClassName='space-y-3'
    >
      <div className='flex items-center gap-2'>
        <Label htmlFor='affiliate-rebate-source' className='shrink-0 text-xs'>
          {t('Source')}
        </Label>
        <Select value={sourceFilter} onValueChange={handleSourceFilterChange}>
          <SelectTrigger id='affiliate-rebate-source' className='h-9 w-44'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value='all'>{t('All sources')}</SelectItem>
              <SelectItem value='signup'>{t('Registration')}</SelectItem>
              <SelectItem value='topup'>{t('Top-up')}</SelectItem>
              <SelectItem value='redemption'>{t('Redemption code')}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <RebateList
        loading={loading}
        rebates={rebates}
        isAdmin={isAdmin}
        onReverse={setReverseTarget}
      />
      {!loading && total > 0 ? (
        <div className='flex items-center justify-between border-t pt-3'>
          <span className='text-muted-foreground text-xs'>
            {t('Page {{page}} of {{totalPages}}', { page, totalPages })}
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='size-8 p-0'
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              aria-label={t('Previous page')}
            >
              <ChevronLeft className='size-4' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='size-8 p-0'
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
              disabled={page >= totalPages}
              aria-label={t('Next page')}
            >
              <ChevronRight className='size-4' />
            </Button>
          </div>
        </div>
      ) : null}
      <AlertDialog
        open={reverseTarget !== null}
        onOpenChange={(open) => {
          if (!open && !reversing) {
            setReverseTarget(null)
            setReverseReason('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Reverse referral rebate?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "This will reverse the selected paid-code rebate and debit the inviter's wallet."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='affiliate-rebate-reason'>
              {t('Reversal reason (optional)')}
            </Label>
            <Input
              id='affiliate-rebate-reason'
              value={reverseReason}
              onChange={(event) => setReverseReason(event.target.value)}
              maxLength={255}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reversing}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReverse}
              disabled={reversing}
            >
              {reversing ? t('Processing...') : t('Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
