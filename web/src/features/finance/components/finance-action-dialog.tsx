import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import { ComboboxInput } from '@/components/ui/combobox-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { searchUsers } from '@/features/users/api'
import type { User } from '@/features/users/types'
import { useDebounce } from '@/hooks/use-debounce'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { formatQuota, parseQuotaFromDollars } from '@/lib/format'

import {
  applyFinancePenalty,
  refundFinanceRedemption,
  refundFinanceTopup,
  reverseFinancePenalty,
  reverseFinanceRebate,
} from '../api'
import type { FinanceAction, PenaltyMode } from '../types'

export function FinanceActionDialog(props: {
  action: FinanceAction | null
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
  const action = props.action

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
      props.onSuccess()
      props.onClose()
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
    <AlertDialog open onOpenChange={(open) => !open && props.onClose()}>
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
