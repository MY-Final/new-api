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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { nanoid } from 'nanoid'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getUser } from '@/features/users/api'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { formatQuotaPrecise, parseQuotaFromDollars } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { createManualCredit } from '../api'
import { creditSchema, type CreditForm } from '../lib/manual-credit'
import type { ManualCreditInput } from '../types'
import { FinanceUserFilter } from './finance-user-filter'

export function ManualCreditForm() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [userId, setUserId] = useState<number>()
  const [clientId, setClientId] = useState(() => nanoid())
  const [preview, setPreview] = useState<ManualCreditInput | null>(null)
  const [received, setReceived] = useState(false)
  const form = useForm<CreditForm>({
    resolver: zodResolver(creditSchema),
    defaultValues: { paid: '', bonus: '', reference: '', reason: '' },
  })
  const user = useQuery({
    queryKey: ['finance-credit-user', userId],
    queryFn: async () => requireServerSuccess(await getUser(userId ?? 0)).data,
    enabled: Boolean(userId),
    retry: false,
    meta: { errorToast: false },
  })
  const paidAmount = Number(form.watch('paid'))
  const bonusAmount = Number(form.watch('bonus'))
  const paid = parseQuotaFromDollars(paidAmount)
  const bonus = parseQuotaFromDollars(bonusAmount)
  const total = paid + bonus
  const validTotal =
    Number.isFinite(paidAmount) &&
    paidAmount >= 0 &&
    Number.isFinite(bonusAmount) &&
    bonusAmount >= 0 &&
    Number.isSafeInteger(paid) &&
    paid >= 0 &&
    Number.isSafeInteger(bonus) &&
    bonus >= 0 &&
    Number.isSafeInteger(total) &&
    total > 0
  const currency = getCurrencyLabel()
  const step = getCurrencyDisplay().meta.kind === 'tokens' ? 1 : 0.000001
  const mutation = useMutation({
    mutationFn: createManualCredit,
    onSuccess: (result) => {
      toast.success(
        `${t('Credit recorded successfully')} · #${result.operation.id}`
      )
      setPreview(null)
      setReceived(false)
      setClientId(nanoid())
      form.reset()
      void queryClient.invalidateQueries({ queryKey: ['finance'] })
      void queryClient.invalidateQueries({
        queryKey: ['finance-credit-user', userId],
      })
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['self'] })
      void queryClient.invalidateQueries({ queryKey: ['ledger'] })
      void queryClient.invalidateQueries({ queryKey: ['audit'] })
    },
    onError: (error) => handleServerError(error),
  })
  const submit = form.handleSubmit((values) => {
    if (
      !validTotal ||
      !userId ||
      user.isError ||
      !user.data ||
      user.data.id !== userId ||
      !Number.isSafeInteger(user.data.quota + total)
    ) {
      return
    }
    if (paid > 0 && !values.reference) {
      form.setError('reference', {
        message: 'Payment reference is required for paid credit',
      })
      return
    }
    setReceived(false)
    setPreview({
      user_id: userId,
      paid_quota: paid,
      bonus_quota: bonus,
      reason: values.reason,
      reference: values.reference,
      client_id: clientId,
      payment_received: false,
    })
  })

  return (
    <>
      <div className='grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]'>
        <Card>
          <CardHeader>
            <CardTitle>{t('Credit details')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={submit} className='space-y-5'>
                <fieldset
                  disabled={mutation.isPending || Boolean(preview)}
                  className='space-y-5 disabled:opacity-60'
                >
                  <div className='space-y-2'>
                    <Label>{t('Target user')}</Label>
                    <FinanceUserFilter value={userId} onChange={setUserId} />
                  </div>
                  <div className='grid gap-4 sm:grid-cols-2'>
                    {(['paid', 'bonus'] as const).map((name) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {name === 'paid'
                                ? t('Paid credit')
                                : t('Promotional credit')}{' '}
                              ({currency})
                            </FormLabel>
                            <FormControl>
                              <Input
                                type='number'
                                min={0}
                                step={step}
                                placeholder='0'
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              {name === 'paid'
                                ? t(
                                    'Added to paid balance after receiving an offline payment.'
                                  )
                                : t(
                                    'Added to bonus balance for gifts, trials, or compensation.'
                                  )}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormField
                    control={form.control}
                    name='reference'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t('Payment reference')}{' '}
                          {paid > 0 ? '*' : `(${t('Optional')})`}
                        </FormLabel>
                        <FormControl>
                          <Input maxLength={128} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='reason'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Reason')} *</FormLabel>
                        <FormControl>
                          <Textarea maxLength={255} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type='submit'
                    disabled={
                      !user.data ||
                      user.isError ||
                      user.isFetching ||
                      !validTotal ||
                      !Number.isSafeInteger(user.data.quota + total)
                    }
                  >
                    {t('Review credit')}
                  </Button>
                </fieldset>
              </form>
            </Form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('Balance preview')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {user.isError ? (
              <ErrorState
                className='min-h-0 py-2'
                onRetry={() => void user.refetch()}
              />
            ) : null}
            {user.isFetching ? <p role='status'>{t('Loading...')}</p> : null}
            {user.data ? (
              <div className='rounded-lg border p-3'>
                <p className='font-medium break-all'>
                  {user.data.display_name || user.data.username} (@
                  {user.data.username}) · #{user.data.id}
                </p>
                <dl className='mt-3 space-y-2 text-sm tabular-nums'>
                  {[
                    { label: t('Current balance'), value: user.data.quota },
                    {
                      label: t('Paid quota'),
                      value:
                        user.data.paid_quota ||
                        (!user.data.bonus_quota ? user.data.quota : 0),
                    },
                    {
                      label: t('Bonus quota'),
                      value: user.data.bonus_quota ?? 0,
                    },
                    { label: t('Paid credit'), value: paid },
                    { label: t('Promotional credit'), value: bonus },
                    {
                      label: t('Balance after credit'),
                      value: user.data.quota + total,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className='flex flex-wrap justify-between gap-2'
                    >
                      <dt className='text-muted-foreground'>{item.label}</dt>
                      <dd>{formatQuotaPrecise(item.value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {t('Select a user to preview the balance change.')}
              </p>
            )}
            <p className='text-muted-foreground text-sm leading-relaxed'>
              {t(
                'Manual credits update the wallet only. They do not collect payment or generate referral rebates. Paid and promotional amounts are recorded separately.'
              )}
            </p>
            <p className='text-muted-foreground text-xs'>
              {t(
                'The final balance is calculated when the credit is committed.'
              )}
            </p>
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setPreview(null)
        }}
        title={t('Confirm manual credit')}
        desc={t('Verify the recipient and credit amounts before continuing.')}
        confirmText={
          mutation.isPending ? t('Processing...') : t('Confirm credit')
        }
        isLoading={mutation.isPending}
        disabled={!preview || (preview.paid_quota > 0 && !received)}
        handleConfirm={() => {
          if (preview) {
            mutation.mutate({
              ...preview,
              payment_received: preview.paid_quota > 0 && received,
            })
          }
        }}
      >
        <div className='space-y-3 text-sm'>
          <p className='break-all'>
            {user.data?.username} · #{preview?.user_id}
          </p>
          <p>
            {t('Paid credit')}: {formatQuotaPrecise(preview?.paid_quota || 0)}
          </p>
          <p>
            {t('Promotional credit')}:{' '}
            {formatQuotaPrecise(preview?.bonus_quota || 0)}
          </p>
          <p className='break-all'>
            {t('Payment reference')}: {preview?.reference || '—'}
          </p>
          <p className='break-all'>
            {t('Reason')}: {preview?.reason}
          </p>
          {Boolean(preview?.paid_quota) && (
            <div className='flex items-start gap-2'>
              <Checkbox
                id='credit-received'
                checked={received}
                disabled={mutation.isPending}
                onCheckedChange={(checked) => setReceived(checked === true)}
              />
              <Label htmlFor='credit-received'>
                {t('I confirm the offline payment has been received')}
              </Label>
            </div>
          )}
        </div>
      </ConfirmDialog>
    </>
  )
}
