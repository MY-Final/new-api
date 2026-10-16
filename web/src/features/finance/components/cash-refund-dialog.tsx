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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import z from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency } from '@/features/wallet/lib/format'
import { formatQuotaPrecise } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { refundFinanceRedemption, refundFinanceTopup } from '../api'
import type { FinanceAction } from '../types'

const refundSchema = z.object({
  reason: z.string().trim().min(1).max(255),
  externalConfirmed: z.boolean().refine(Boolean),
  negativeConfirmed: z.boolean(),
})

export function CashRefundDialog(props: {
  action: Extract<FinanceAction, { kind: 'topup-refund' | 'redemption-refund' }>
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const form = useForm<z.infer<typeof refundSchema>>({
    resolver: zodResolver(refundSchema),
    mode: 'onChange',
    defaultValues: {
      reason: '',
      externalConfirmed: false,
      negativeConfirmed: false,
    },
  })
  const values = form.watch()
  const action = props.action
  const topup = action.kind === 'topup-refund' ? action.item : null
  const redemption = action.kind === 'redemption-refund' ? action.item : null
  const principal = topup?.credited_quota ?? redemption?.quota
  const balance = topup ? topup.user_quota : redemption?.used_user_quota
  const validSnapshot =
    principal !== undefined &&
    principal > 0 &&
    Number.isSafeInteger(principal) &&
    balance !== undefined &&
    Number.isSafeInteger(balance) &&
    Number.isSafeInteger(balance - principal)
  const after = validSnapshot ? balance - principal : undefined
  const negative = after !== undefined && after < 0
  const title = topup ? t('Refund top-up') : t('Refund redemption')
  const mutation = useMutation({
    mutationFn: async (reason: string) => {
      if (topup) return refundFinanceTopup(topup.trade_no, reason)
      return refundFinanceRedemption(action.item.id, reason)
    },
    onSuccess: () => {
      toast.success(t('Financial operation completed'))
      props.onSuccess()
      props.onClose()
    },
    onError: (error) =>
      handleServerError(error, t('Financial operation failed')),
  })
  const rows = [
    {
      label: t('Target user'),
      value: topup
        ? `${topup.username || ''} · #${topup.user_id}`
        : `${redemption?.used_username || ''} · #${redemption?.used_user_id}`,
    },
    {
      label: topup ? t('Order number') : t('Redemption code'),
      value: topup?.trade_no || `#${redemption?.id} · ${redemption?.name}`,
    },
    {
      label: t('Current balance'),
      value: balance !== undefined ? formatQuotaPrecise(balance) : t('Unknown'),
    },
    {
      label: t('Principal deduction'),
      value:
        principal !== undefined
          ? `−${formatQuotaPrecise(principal)}`
          : t('Unknown'),
    },
    {
      label: t('After operation'),
      value: after !== undefined ? formatQuotaPrecise(after) : t('Unknown'),
    },
    {
      label: t('Inviter rebate'),
      value: formatQuotaPrecise(
        Math.max(
          0,
          (action.item.rebate_quota || 0) -
            (action.item.rebate_reversed_quota || 0)
        )
      ),
    },
  ]
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (open || mutation.isPending) return
        if (confirming) setConfirming(false)
        else props.onClose()
      }}
      title={confirming ? `${t('Confirm')}: ${title}` : title}
      desc={
        confirming
          ? t('This action cannot be undone.')
          : t(
              'This changes local accounting only. Complete the external refund first.'
            )
      }
      className='data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-2xl'
      destructive={confirming}
      cancelBtnText={confirming ? t('Back') : t('Cancel')}
      confirmText={confirming ? t('Confirm') : t('Continue')}
      isLoading={mutation.isPending}
      disabled={
        !form.formState.isValid ||
        !validSnapshot ||
        (negative && !values.negativeConfirmed)
      }
      handleConfirm={() => {
        if (!validSnapshot || (negative && !values.negativeConfirmed)) return
        void form.handleSubmit((input) => {
          if (!confirming) setConfirming(true)
          else mutation.mutate(input.reason)
        })()
      }}
    >
      <div className='bg-muted/40 rounded-lg border p-3 text-sm'>
        <p className='font-medium'>
          {t('Cash returned externally → balance deducted here')}
        </p>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t(
            'The full original credit is deducted. Related referral rebates are reversed automatically. Partial refunds are not supported here.'
          )}
        </p>
      </div>
      <dl className='grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2'>
        {rows.map((row) => (
          <div key={row.label} className='min-w-0'>
            <dt className='text-muted-foreground text-xs'>{row.label}</dt>
            <dd className='mt-1 font-medium break-words tabular-nums'>
              {row.value}
            </dd>
          </div>
        ))}
        {topup ? (
          <div className='min-w-0 sm:col-span-2'>
            <dt className='text-muted-foreground text-xs'>
              {t('Original payment amount')}
            </dt>
            <dd className='mt-1 font-medium'>
              {t('{{amount}} (order currency)', {
                amount: formatCurrency(topup.money),
              })}{' '}
              · {topup.payment_method}
            </dd>
          </div>
        ) : null}
      </dl>
      {!validSnapshot ? (
        <p role='alert' className='text-destructive text-sm'>
          {t(
            'Balance or original credit is unavailable. Refresh the order before refunding.'
          )}
        </p>
      ) : null}
      {negative ? (
        <div
          role='alert'
          className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm'
        >
          {t(
            'The original credit exceeds the current balance. Registering this refund will leave a negative balance.'
          )}
        </div>
      ) : null}
      {confirming ? (
        <div className='space-y-2 text-sm'>
          <p className='text-muted-foreground'>{t('Reason')}</p>
          <p className='break-words whitespace-pre-wrap'>{values.reason}</p>
          <p>{t('I confirm the external refund has been completed')}</p>
          {negative ? (
            <p>{t('I confirm the resulting negative balance')}</p>
          ) : null}
        </div>
      ) : (
        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='cash-refund-reason'>{t('Reason')}</Label>
            <Textarea
              id='cash-refund-reason'
              maxLength={255}
              {...form.register('reason')}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'Include the refund channel and transaction reference in the reason.'
              )}
            </p>
          </div>
          <Controller
            control={form.control}
            name='externalConfirmed'
            render={({ field }) => (
              <div className='flex items-start gap-2'>
                <Checkbox
                  id='cash-refund-external'
                  checked={field.value}
                  onCheckedChange={(value) => field.onChange(value === true)}
                />
                <Label
                  htmlFor='cash-refund-external'
                  className='text-sm leading-5'
                >
                  {t('I confirm the external refund has been completed')}
                </Label>
              </div>
            )}
          />
          {negative ? (
            <Controller
              control={form.control}
              name='negativeConfirmed'
              render={({ field }) => (
                <div className='flex items-start gap-2'>
                  <Checkbox
                    id='cash-refund-negative'
                    checked={field.value}
                    onCheckedChange={(value) => field.onChange(value === true)}
                  />
                  <Label
                    htmlFor='cash-refund-negative'
                    className='text-sm leading-5'
                  >
                    {t('I confirm the resulting negative balance')}
                  </Label>
                </div>
              )}
            />
          ) : null}
        </div>
      )}
    </ConfirmDialog>
  )
}
