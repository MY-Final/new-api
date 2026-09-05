import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
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
import { Card, CardContent } from '@/components/ui/card'
import { ComboboxInput } from '@/components/ui/combobox-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { searchUsers } from '@/features/users/api'
import type { User } from '@/features/users/types'
import { useDebounce } from '@/hooks/use-debounce'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import {
  formatQuotaPrecise,
  formatQuota,
  formatTimestampToDate,
  parseQuotaFromDollars,
} from '@/lib/format'

import {
  applyFinancePenalty,
  completeFinanceTopup,
  getFinanceRebates,
  getFinanceRedemptions,
  getFinanceTopups,
  getFinancialOperations,
  refundFinanceRedemption,
  refundFinanceTopup,
  reverseFinancePenalty,
  reverseFinanceRebate,
} from './api'
import type {
  FinanceFilters,
  FinanceRebate,
  FinanceRedemption,
  FinanceTopup,
  FinancialOperation,
  PageData,
} from './types'

type Section = 'topups' | 'redemptions' | 'rebates' | 'operations'
type PenaltyMode = 'request' | 'custom'
type Action =
  | { kind: 'topup-refund'; item: FinanceTopup }
  | { kind: 'redemption-refund'; item: FinanceRedemption }
  | { kind: 'rebate-reverse'; item: FinanceRebate }
  | { kind: 'penalty'; item?: undefined }
  | { kind: 'penalty-reverse'; item: FinancialOperation }

const sectionNames: Record<Section, string> = {
  topups: 'Top-up Orders',
  redemptions: 'Redemption Codes',
  rebates: 'Rebate Ledger',
  operations: 'Financial Operations',
}

function asSection(value: string): Section {
  if (
    value === 'redemptions' ||
    value === 'rebates' ||
    value === 'operations'
  ) {
    return value
  }
  return 'topups'
}

function filterPlaceholder(section: Section, t: (key: string) => string) {
  if (section === 'topups') return t('Order number')
  if (section === 'redemptions') return t('Code, name, or ID')
  return t('Source ID')
}

function filterUserLabel(section: Section, t: (key: string) => string) {
  return t(section === 'rebates' ? 'Inviter ID' : 'Operator ID')
}

function getStatusLabel(status: string, t: (key: string) => string) {
  const labels: Record<string, string> = {
    all: 'All statuses',
    success: 'Success',
    pending: 'Pending',
    used: 'Used',
    refunded: 'Refunded',
    settled: 'Settled',
    reversed: 'Reversed',
    expired: 'Expired',
    failed: 'Failed',
  }
  return labels[status] ? t(labels[status]) : status
}

function getProviderLabel(provider: string, t: (key: string) => string) {
  if (provider === 'all') return t('All providers')
  if (provider === 'epay') return 'Epay'
  if (provider === 'stripe') return 'Stripe'
  if (provider === 'creem') return 'Creem'
  if (provider === 'waffo') return 'Waffo'
  return provider
}

function getCodeTypeLabel(type: string, t: (key: string) => string) {
  if (type === 'all') return t('All types')
  if (type === 'paid') return t('Paid code')
  if (type === 'reward') return t('Reward code')
  return type
}

function getSourceLabel(source: string, t: (key: string) => string) {
  if (source === 'all') return t('All sources')
  if (source === 'signup') return t('Registration')
  if (source === 'topup') return t('Top-up')
  if (source === 'redemption') return t('Redemption code')
  return source
}

function getOperationTypeLabel(type: string, t: (key: string) => string) {
  const labels: Record<string, string> = {
    topup_refund: 'Refund top-up',
    redemption_refund: 'Refund redemption',
    rebate_reversal: 'Reverse rebate',
    penalty: 'Apply penalty',
    penalty_reversal: 'Reverse penalty',
  }
  return labels[type] ? t(labels[type]) : type
}

function FinanceFiltersBar({
  section,
  filters,
  setFilters,
}: {
  section: Section
  filters: FinanceFilters
  setFilters: (value: FinanceFilters) => void
}) {
  const { t } = useTranslation()
  const [range, setRange] = useState<{ start?: Date; end?: Date }>({})
  const update = (key: keyof FinanceFilters, value: string) => {
    setFilters({
      ...filters,
      page: 1,
      [key]: value === '' ? undefined : value,
    })
  }
  return (
    <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>
      <Input
        value={filters.keyword || ''}
        placeholder={filterPlaceholder(section, t)}
        onChange={(event) => update('keyword', event.target.value)}
      />
      {(section === 'topups' || section === 'redemptions') && (
        <Input
          type='number'
          value={filters.userId || ''}
          placeholder={t('User ID')}
          onChange={(event) => update('userId', event.target.value)}
        />
      )}
      {(section === 'rebates' || section === 'operations') && (
        <Input
          type='number'
          value={
            (section === 'rebates' ? filters.inviterId : filters.operatorId) ||
            ''
          }
          placeholder={filterUserLabel(section, t)}
          onChange={(event) =>
            update(
              section === 'rebates' ? 'inviterId' : 'operatorId',
              event.target.value
            )
          }
        />
      )}
      <Select
        value={filters.status || 'all'}
        onValueChange={(value) =>
          setFilters({
            ...filters,
            page: 1,
            status: value === 'all' ? undefined : value || undefined,
          })
        }
      >
        <SelectTrigger>
          <SelectValue>
            {getStatusLabel(filters.status || 'all', t)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='all'>{t('All statuses')}</SelectItem>
          <SelectItem value='success'>{t('Success')}</SelectItem>
          <SelectItem value='pending'>{t('Pending')}</SelectItem>
          <SelectItem value='used'>{t('Used')}</SelectItem>
          <SelectItem value='refunded'>{t('Refunded')}</SelectItem>
          <SelectItem value='settled'>{t('Settled')}</SelectItem>
          <SelectItem value='reversed'>{t('Reversed')}</SelectItem>
        </SelectContent>
      </Select>
      {section === 'topups' && (
        <Select
          value={filters.provider || 'all'}
          onValueChange={(value) =>
            setFilters({
              ...filters,
              page: 1,
              provider: value === 'all' ? undefined : value || undefined,
            })
          }
        >
          <SelectTrigger>
            <SelectValue>
              {getProviderLabel(filters.provider || 'all', t)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>{t('All providers')}</SelectItem>
            <SelectItem value='epay'>Epay</SelectItem>
            <SelectItem value='stripe'>Stripe</SelectItem>
            <SelectItem value='creem'>Creem</SelectItem>
            <SelectItem value='waffo'>Waffo</SelectItem>
          </SelectContent>
        </Select>
      )}
      {section === 'redemptions' && (
        <Select
          value={filters.sourceType || 'all'}
          onValueChange={(value) =>
            setFilters({
              ...filters,
              page: 1,
              sourceType: value === 'all' ? undefined : value || undefined,
            })
          }
        >
          <SelectTrigger>
            <SelectValue>
              {getCodeTypeLabel(filters.sourceType || 'all', t)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>{t('All types')}</SelectItem>
            <SelectItem value='paid'>{t('Paid code')}</SelectItem>
            <SelectItem value='reward'>{t('Reward code')}</SelectItem>
          </SelectContent>
        </Select>
      )}
      <CompactDateTimeRangePicker
        start={range.start}
        end={range.end}
        onChange={(next) => {
          setRange(next)
          setFilters({
            ...filters,
            page: 1,
            startTime: next.start
              ? Math.floor(next.start.getTime() / 1000)
              : undefined,
            endTime: next.end
              ? Math.floor(next.end.getTime() / 1000)
              : undefined,
          })
        }}
      />
    </div>
  )
}

function FinanceActionDialog({
  action,
  onClose,
  onSuccess,
}: {
  action: Action | null
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [externalConfirmed, setExternalConfirmed] = useState(false)
  const [quota, setQuota] = useState('')
  const [userId, setUserId] = useState('')
  const [penaltyMode, setPenaltyMode] = useState<PenaltyMode>('request')
  const [penaltyUserSearch, setPenaltyUserSearch] = useState('')
  const [selectedPenaltyUser, setSelectedPenaltyUser] = useState<User | null>(
    null
  )
  const [requestId, setRequestId] = useState('')
  const [customPenaltyRequestId, setCustomPenaltyRequestId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const debouncedPenaltyUserSearch = useDebounce(penaltyUserSearch, 250)
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'

  const penaltyUsersQuery = useQuery({
    queryKey: ['finance-penalty-users', debouncedPenaltyUserSearch],
    queryFn: async () => {
      const response = await searchUsers({
        keyword: debouncedPenaltyUserSearch.trim(),
        status: '1',
        p: 1,
        page_size: 20,
        sort_by: 'username',
        sort_order: 'asc',
      })
      if (!response.success) {
        throw new Error(response.message || t('Failed to search users'))
      }
      return response.data?.items || []
    },
    enabled: action?.kind === 'penalty',
    staleTime: 30_000,
  })
  const penaltyUsers = penaltyUsersQuery.data || []
  const selectablePenaltyUsers =
    selectedPenaltyUser &&
    !penaltyUsers.some((user) => user.id === selectedPenaltyUser.id)
      ? [selectedPenaltyUser, ...penaltyUsers]
      : penaltyUsers
  const penaltyUserOptions = selectablePenaltyUsers.map((user) => ({
    value: String(user.id),
    label: `${user.display_name || user.username} (@${user.username}) · ${t('User ID')}: ${user.id}`,
  }))
  const penaltyAmount = Number(quota)
  const penaltyQuota = parseQuotaFromDollars(Math.abs(penaltyAmount))
  const penaltyRequestId =
    penaltyMode === 'custom' ? customPenaltyRequestId : requestId.trim()
  const penaltyFormInvalid =
    action?.kind === 'penalty' &&
    (!userId ||
      !Number.isFinite(penaltyAmount) ||
      penaltyAmount <= 0 ||
      penaltyQuota <= 0 ||
      !penaltyRequestId)

  useEffect(() => {
    if (action === null) {
      setConfirming(false)
      setReason('')
      setExternalConfirmed(false)
      setQuota('')
      setUserId('')
      setPenaltyMode('request')
      setPenaltyUserSearch('')
      setSelectedPenaltyUser(null)
      setRequestId('')
      setCustomPenaltyRequestId('')
    } else if (action.kind === 'penalty') {
      setConfirming(false)
      setCustomPenaltyRequestId(
        `manual-${globalThis.crypto?.randomUUID?.() || Date.now()}`
      )
    } else {
      setConfirming(false)
    }
  }, [action])

  if (action === null) return null
  let title = t('Reverse penalty')
  if (action?.kind === 'topup-refund') title = t('Refund top-up')
  if (action?.kind === 'redemption-refund') title = t('Refund redemption')
  if (action?.kind === 'rebate-reverse') title = t('Reverse rebate')
  if (action?.kind === 'penalty') title = t('Apply penalty')
  let description = t(
    'This operation is recorded in the immutable financial audit log.'
  )
  if (action?.kind === 'rebate-reverse') {
    description = t('The invited user balance will not change.')
  }
  if (action?.kind.includes('refund')) {
    description = t(
      'This changes local accounting only. Complete the external refund first.'
    )
  }
  let targetQuota: number | undefined
  let principal: number | undefined
  let inviterQuota: number | undefined
  let inviterRebate: number | undefined
  if (action?.kind === 'topup-refund') {
    targetQuota = action.item.user_quota
    principal = action.item.credited_quota || action.item.amount
    inviterQuota = action.item.inviter_quota
    inviterRebate = action.item.rebate_quota
  } else if (action?.kind === 'redemption-refund') {
    targetQuota = action.item.used_user_quota
    principal = action.item.quota
    inviterQuota = action.item.inviter_quota
    inviterRebate = action.item.rebate_quota
  } else if (action?.kind === 'rebate-reverse') {
    inviterQuota = action.item.inviter_quota
    inviterRebate = action.item.rebate_quota
  }
  const prepareSubmit = () => {
    if (
      !reason.trim() ||
      penaltyFormInvalid ||
      (action.kind.includes('refund') && !externalConfirmed)
    ) {
      return
    }
    setConfirming(true)
  }

  const execute = async () => {
    if (
      !reason.trim() ||
      penaltyFormInvalid ||
      (action.kind.includes('refund') && !externalConfirmed)
    ) {
      return
    }
    setLoading(true)
    try {
      if (action.kind === 'topup-refund') {
        await refundFinanceTopup(action.item.trade_no, reason)
      }
      if (action.kind === 'redemption-refund') {
        await refundFinanceRedemption(action.item.id, reason)
      }
      if (action.kind === 'rebate-reverse') {
        await reverseFinanceRebate(action.item.id, reason)
      }
      if (action.kind === 'penalty') {
        await applyFinancePenalty(
          Number(userId),
          penaltyQuota,
          reason,
          penaltyRequestId
        )
      }
      if (action.kind === 'penalty-reverse') {
        await reverseFinancePenalty(action.item.id, reason)
      }
      toast.success(t('Financial operation completed'))
      onSuccess()
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Financial operation failed')
      )
    } finally {
      setLoading(false)
    }
  }
  let confirmButtonLabel = t('Continue')
  if (confirming) confirmButtonLabel = t('Confirm')
  if (loading) confirmButtonLabel = t('Processing...')

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirming ? `${t('Confirm')}: ${title}` : title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirming ? t('This action cannot be undone.') : description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirming ? (
          <div className='space-y-3 rounded-lg border p-3 text-sm'>
            <div className='flex items-start justify-between gap-3'>
              <span className='text-muted-foreground'>{t('Operation')}</span>
              <span className='text-right font-medium'>{title}</span>
            </div>
            {principal !== undefined ? (
              <>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>
                    {t('Principal deduction')}
                  </span>
                  <span className='font-medium'>{formatQuota(principal)}</span>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>
                    {t('After operation')}
                  </span>
                  <span className='font-medium'>
                    {formatQuota((targetQuota || 0) - principal)}
                  </span>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>
                    {t('Inviter rebate')}
                  </span>
                  <span className='text-right font-medium'>
                    {formatQuota(inviterRebate || 0)}
                    {inviterQuota !== undefined
                      ? ` · ${t('Inviter balance')}: ${formatQuota(inviterQuota)}`
                      : ''}
                  </span>
                </div>
              </>
            ) : null}
            {action.kind === 'penalty' ? (
              <>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>
                    {t('Target user')}
                  </span>
                  <span className='text-right font-medium'>
                    {selectedPenaltyUser?.display_name ||
                      selectedPenaltyUser?.username}{' '}
                    · {t('User ID')}: {userId}
                  </span>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>{t('Amount')}</span>
                  <span className='font-medium'>
                    {quota} {currencyLabel}
                  </span>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>
                    {t('After operation')}
                  </span>
                  <span className='font-medium'>
                    {formatQuota(
                      (selectedPenaltyUser?.quota || 0) - penaltyQuota
                    )}
                  </span>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>
                    {t('Request ID')}
                  </span>
                  <span className='max-w-[65%] text-right font-medium break-all'>
                    {penaltyRequestId}
                  </span>
                </div>
              </>
            ) : null}
            {action.kind === 'penalty-reverse' ? (
              <>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>
                    {t('Target user')}
                  </span>
                  <span className='text-right font-medium'>
                    {action.item.target_username} · {t('User ID')}:{' '}
                    {action.item.target_user_id}
                  </span>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>{t('Amount')}</span>
                  <span className='font-medium'>
                    {formatQuota(action.item.principal_quota)}
                  </span>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>
                    {t('After operation')}
                  </span>
                  <span className='font-medium'>
                    {formatQuota(action.item.target_main_after)}
                  </span>
                </div>
              </>
            ) : null}
            {action.kind === 'rebate-reverse' ? (
              <>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>{t('Rebate')}</span>
                  <span className='font-medium'>
                    {formatQuota(inviterRebate || 0)}
                  </span>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <span className='text-muted-foreground'>
                    {t('Inviter balance')}
                  </span>
                  <span className='font-medium'>
                    {formatQuota(inviterQuota || 0)}
                  </span>
                </div>
                <div className='text-muted-foreground'>
                  {t('The invited user balance will not change.')}
                </div>
              </>
            ) : null}
            <div className='space-y-1'>
              <div className='text-muted-foreground'>{t('Reason')}</div>
              <div className='font-medium break-words'>{reason}</div>
            </div>
            {action.kind.includes('refund') ? (
              <div className='text-muted-foreground'>
                {t('I confirm the external refund has been completed')}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {principal !== undefined ? (
              <div className='grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm'>
                <div>
                  <div className='text-muted-foreground'>
                    {t('Current balance')}
                  </div>
                  <div className='font-semibold'>
                    {formatQuota(targetQuota || 0)}
                  </div>
                </div>
                <div>
                  <div className='text-muted-foreground'>
                    {t('After operation')}
                  </div>
                  <div className='font-semibold'>
                    {formatQuota((targetQuota || 0) - principal)}
                  </div>
                </div>
                <div>
                  <div className='text-muted-foreground'>
                    {t('Principal deduction')}
                  </div>
                  <div className='font-semibold'>{formatQuota(principal)}</div>
                </div>
                <div>
                  <div className='text-muted-foreground'>
                    {t('Inviter rebate')}
                  </div>
                  <div className='font-semibold'>
                    {formatQuota(inviterRebate || 0)}
                    {inviterQuota !== undefined
                      ? ` · ${t('Inviter balance')}: ${formatQuota(inviterQuota)}`
                      : ''}
                  </div>
                </div>
              </div>
            ) : null}
            {action?.kind === 'penalty' ? (
              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-1 sm:col-span-2'>
                  <Label>{t('Mode')}</Label>
                  <div className='flex gap-1'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      className={
                        penaltyMode === 'request'
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                          : undefined
                      }
                      onClick={() => setPenaltyMode('request')}
                    >
                      {t('Request-based penalty')}
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      className={
                        penaltyMode === 'custom'
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                          : undefined
                      }
                      onClick={() => setPenaltyMode('custom')}
                    >
                      {t('Custom penalty')}
                    </Button>
                  </div>
                </div>
                <div className='space-y-1 sm:col-span-2'>
                  <Label htmlFor='finance-penalty-user'>
                    {t('Target user')}
                  </Label>
                  <ComboboxInput
                    id='finance-penalty-user'
                    options={penaltyUserOptions}
                    value={userId || penaltyUserSearch}
                    onValueChange={(value) => {
                      const user = selectablePenaltyUsers.find(
                        (item) => String(item.id) === value
                      )
                      if (!user) return
                      setSelectedPenaltyUser(user)
                      setUserId(value)
                      setPenaltyUserSearch('')
                    }}
                    onSearchChange={setPenaltyUserSearch}
                    placeholder={t('Search by username, name, or ID')}
                    emptyText={
                      penaltyUsersQuery.isFetching
                        ? t('Loading...')
                        : t('No users found')
                    }
                  />
                  {selectedPenaltyUser ? (
                    <div className='bg-muted/50 text-muted-foreground rounded-md px-3 py-2 text-xs'>
                      {selectedPenaltyUser.display_name ||
                        selectedPenaltyUser.username}{' '}
                      · {t('User ID')}: {selectedPenaltyUser.id} ·{' '}
                      {t('Current balance')}:{' '}
                      {formatQuota(selectedPenaltyUser.quota)}
                    </div>
                  ) : null}
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='finance-penalty-amount'>
                    {t('Amount')} ({currencyLabel})
                  </Label>
                  <Input
                    id='finance-penalty-amount'
                    type='number'
                    min='0'
                    step={tokensOnly ? 1 : 0.01}
                    value={quota}
                    onChange={(event) => setQuota(event.target.value)}
                    placeholder={
                      tokensOnly
                        ? t('Enter amount in tokens')
                        : t('Enter amount in {{currency}}', {
                            currency: currencyLabel,
                          })
                    }
                  />
                </div>
                {penaltyMode === 'request' ? (
                  <div className='space-y-1'>
                    <Label>{t('Request ID')}</Label>
                    <Input
                      value={requestId}
                      onChange={(event) => setRequestId(event.target.value)}
                    />
                  </div>
                ) : (
                  <div className='text-muted-foreground flex items-end pb-2 text-xs'>
                    {t('Custom penalties do not require a request ID.')}
                  </div>
                )}
                {selectedPenaltyUser && penaltyQuota > 0 ? (
                  <div className='text-muted-foreground text-xs sm:col-span-2'>
                    {t('After operation')}:{' '}
                    {formatQuota(selectedPenaltyUser.quota - penaltyQuota)}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className='space-y-2'>
              <Label htmlFor='finance-action-reason'>{t('Reason')}</Label>
              <Input
                id='finance-action-reason'
                value={reason}
                maxLength={255}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            {action?.kind.includes('refund') ? (
              <label className='flex items-center gap-2 text-sm'>
                <input
                  type='checkbox'
                  checked={externalConfirmed}
                  onChange={(event) =>
                    setExternalConfirmed(event.target.checked)
                  }
                />
                {t('I confirm the external refund has been completed')}
              </label>
            ) : null}
          </>
        )}
        <AlertDialogFooter>
          {confirming ? (
            <Button
              variant='outline'
              disabled={loading}
              onClick={() => setConfirming(false)}
            >
              {t('Back')}
            </Button>
          ) : (
            <AlertDialogCancel disabled={loading}>
              {t('Cancel')}
            </AlertDialogCancel>
          )}
          <AlertDialogAction
            disabled={
              loading ||
              (!confirming &&
                (!reason.trim() ||
                  penaltyFormInvalid ||
                  (action?.kind.includes('refund') && !externalConfirmed)))
            }
            onClick={confirming ? execute : prepareSubmit}
          >
            {confirmButtonLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function Finance({ section: rawSection }: { section: string }) {
  const { t } = useTranslation()
  const section = asSection(rawSection)
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<FinanceFilters>({
    page: 1,
    pageSize: 20,
  })
  const [action, setAction] = useState<Action | null>(null)
  const query = useQuery<
    PageData<
      FinanceTopup | FinanceRedemption | FinanceRebate | FinancialOperation
    >
  >({
    queryKey: ['finance', section, filters],
    queryFn: async () => {
      if (section === 'topups') return getFinanceTopups(filters)
      if (section === 'redemptions') return getFinanceRedemptions(filters)
      if (section === 'rebates') return getFinanceRebates(filters)
      return getFinancialOperations(filters)
    },
  })
  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total || 0) / filters.pageSize)
  )
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['finance'] })
    queryClient.invalidateQueries({ queryKey: ['self'] })
  }
  const items = query.data?.items || []
  const tabs = useMemo(() => Object.keys(sectionNames) as Section[], [])
  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Finance')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto w-full max-w-7xl space-y-4'>
            <div className='flex gap-1 overflow-x-auto border-b'>
              {tabs.map((tab) => (
                <Button
                  key={tab}
                  variant={tab === section ? 'secondary' : 'ghost'}
                  size='sm'
                  render={
                    <Link to='/finance/$section' params={{ section: tab }} />
                  }
                >
                  {t(sectionNames[tab])}
                </Button>
              ))}
            </div>
            <FinanceFiltersBar
              section={section}
              filters={filters}
              setFilters={setFilters}
            />
            <div className='space-y-2'>
              {query.isLoading ? (
                <p className='text-muted-foreground py-12 text-center'>
                  {t('Loading...')}
                </p>
              ) : null}
              {!query.isLoading && !items.length ? (
                <p className='text-muted-foreground py-12 text-center'>
                  {t('No financial records found')}
                </p>
              ) : null}
              {section === 'topups' &&
                (items as FinanceTopup[]).map((item) => (
                  <Card key={item.id}>
                    <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
                      <div>
                        <div className='font-medium'>{item.trade_no}</div>
                        <div className='text-muted-foreground text-xs'>
                          {item.username || `${t('User ID')}: ${item.user_id}`}{' '}
                          · {formatTimestampToDate(item.create_time)} ·{' '}
                          {getStatusLabel(item.status, t)}
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          {t('Rebate')}:{' '}
                          {formatQuotaPrecise(item.rebate_quota || 0)} ·{' '}
                          {getProviderLabel(
                            item.payment_provider || item.payment_method,
                            t
                          )}
                        </div>
                      </div>
                      <div className='flex gap-2'>
                        <span className='font-semibold'>
                          {formatQuota(item.credited_quota || item.amount)}
                        </span>
                        {item.status === 'pending' ? (
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => completeFinanceTopup(item.trade_no)}
                          >
                            {t('Complete')}
                          </Button>
                        ) : null}
                        {item.status === 'success' &&
                        item.source !== 'subscription' ? (
                          <Button
                            size='sm'
                            variant='destructive'
                            onClick={() =>
                              setAction({ kind: 'topup-refund', item })
                            }
                          >
                            {t('Refund')}
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              {section === 'redemptions' &&
                (items as FinanceRedemption[]).map((item) => (
                  <Card key={item.id}>
                    <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
                      <div>
                        <div className='font-medium'>
                          {item.name}{' '}
                          <span className='text-muted-foreground text-xs'>
                            #{item.id} · {getCodeTypeLabel(item.type, t)}
                          </span>
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          {item.used_username || t('Unused')} ·{' '}
                          {item.redeemed_time
                            ? formatTimestampToDate(item.redeemed_time)
                            : t('Not redeemed')}
                        </div>
                        <div className='font-mono text-xs'>{item.key}</div>
                      </div>
                      <div className='flex items-center gap-2'>
                        <span className='font-semibold'>
                          {formatQuota(item.quota)}
                        </span>
                        {item.status === 3 && item.type === 'paid' ? (
                          <Button
                            size='sm'
                            variant='destructive'
                            onClick={() =>
                              setAction({ kind: 'redemption-refund', item })
                            }
                          >
                            {t('Refund')}
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              {section === 'rebates' &&
                (items as FinanceRebate[]).map((item) => (
                  <Card key={item.id}>
                    <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
                      <div>
                        <div className='font-medium'>
                          {item.inviter_username || item.inviter_id} ←{' '}
                          {item.invitee_username || item.invitee_id}
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          {getSourceLabel(item.source_type, t)} ·{' '}
                          {item.source_id} ·{' '}
                          {formatTimestampToDate(item.created_at)}
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          {t('Base quota')}:{' '}
                          {formatQuotaPrecise(item.base_quota)} ·{' '}
                          {item.rate / 100}% · {getStatusLabel(item.status, t)}
                        </div>
                        {item.debt_offset_quota > 0 ? (
                          <div className='text-warning text-xs'>
                            {t('Debt settled')}:{' '}
                            {formatQuotaPrecise(item.debt_offset_quota)}
                          </div>
                        ) : null}
                      </div>
                      <div className='flex items-center gap-2'>
                        <span className='font-semibold'>
                          {formatQuotaPrecise(item.rebate_quota)}
                        </span>
                        {item.status !== 'reversed' &&
                        item.source_type !== 'signup' ? (
                          <Button
                            size='sm'
                            variant='destructive'
                            onClick={() =>
                              setAction({ kind: 'rebate-reverse', item })
                            }
                          >
                            {t('Reverse')}
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              {section === 'operations' &&
                (items as FinancialOperation[]).map((item) => (
                  <Card key={item.id}>
                    <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
                      <div>
                        <div className='font-medium'>
                          {t('Financial Operations')} ·{' '}
                          {getOperationTypeLabel(item.operation_type, t)}
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          {item.operator_username} → {item.target_username} ·{' '}
                          {formatTimestampToDate(item.created_at)}
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          {item.reason}
                        </div>
                      </div>
                      <div className='flex items-center gap-2'>
                        <span className='font-semibold'>
                          {formatQuota(
                            item.principal_quota || item.rebate_quota
                          )}
                        </span>
                        {item.operation_type === 'penalty' ? (
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() =>
                              setAction({ kind: 'penalty-reverse', item })
                            }
                          >
                            {t('Reverse')}
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Page {{page}} of {{totalPages}}', {
                  page: filters.page,
                  totalPages,
                })}
              </span>
              <div className='flex gap-2'>
                <Button
                  variant='outline'
                  disabled={filters.page <= 1}
                  onClick={() =>
                    setFilters({ ...filters, page: filters.page - 1 })
                  }
                >
                  {t('Previous')}
                </Button>
                <Button
                  variant='outline'
                  disabled={filters.page >= totalPages}
                  onClick={() =>
                    setFilters({ ...filters, page: filters.page + 1 })
                  }
                >
                  {t('Next')}
                </Button>
                {section === 'operations' ? (
                  <Button onClick={() => setAction({ kind: 'penalty' })}>
                    {t('Apply penalty')}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <FinanceActionDialog
        action={action}
        onClose={() => setAction(null)}
        onSuccess={refresh}
      />
    </>
  )
}
