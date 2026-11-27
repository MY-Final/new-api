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
import { useNavigate } from '@tanstack/react-router'
import { Crown, CalendarClock, Package } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { GroupBadge } from '@/components/group-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Separator } from '@/components/ui/separator'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota, parseQuotaFromDollars } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorStatus } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  paySubscriptionStripe,
  paySubscriptionCreem,
  paySubscriptionEpay,
  paySubscriptionWaffoPancake,
  paySubscriptionBalance,
} from '../../api'
import {
  estimatePlanEndTime,
  formatDuration,
  formatMultiplier,
  formatPlanPrice,
  formatResetPeriod,
  formatWindowDuration,
} from '../../lib'
import type { PlanRecord } from '../../types'

interface PaymentMethod {
  type: string
  name?: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: PlanRecord | null
  enableStripe?: boolean
  enableCreem?: boolean
  enableWaffoPancake?: boolean
  enableOnlineTopUp?: boolean
  epayMethods?: PaymentMethod[]
  purchaseLimit?: number
  purchaseCount?: number
  userQuota?: number
  groupRatioMap?: Record<string, number>
  onPurchaseSuccess?: () => void | Promise<void>
}

export function SubscriptionPurchaseDialog(props: Props) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [paying, setPaying] = useState(false)
  const [selectedEpayMethod, setSelectedEpayMethod] = useState('')

  useEffect(() => {
    if (props.open && props.epayMethods && props.epayMethods.length > 0) {
      setSelectedEpayMethod(props.epayMethods[0].type)
    } else if (!props.open) {
      setSelectedEpayMethod('')
    }
  }, [props.open, props.epayMethods])

  const plan = props.plan?.plan
  if (!plan) return null

  const hasStripe = props.enableStripe && !!plan.stripe_price_id
  const hasCreem = props.enableCreem && !!plan.creem_product_id
  const hasWaffoPancake =
    props.enableWaffoPancake && !!plan.waffo_pancake_product_id
  const hasEpay =
    props.enableOnlineTopUp && (props.epayMethods || []).length > 0
  const hasAnyPayment = hasStripe || hasCreem || hasWaffoPancake || hasEpay
  const totalAmount = Number(plan.total_amount || 0)
  const quotaWindows = plan.quota_windows || []
  const routeGroups = plan.route_groups || []
  const hasQuotaWindows = quotaWindows.length > 0
  const price = formatPlanPrice(
    Number(plan.price_amount || 0),
    plan.currency,
    locale
  )
  const balanceCost = Math.max(
    0,
    parseQuotaFromDollars(Number(plan.price_amount || 0))
  )
  const userQuota = Math.max(0, Number(props.userQuota || 0))
  const planCurrency = (plan.currency || 'CNY').trim().toUpperCase()
  const balanceCurrencyUnavailable =
    plan.allow_balance_pay !== false && planCurrency !== 'CNY'
  const allowBalancePay =
    plan.allow_balance_pay !== false && planCurrency === 'CNY'
  const insufficientBalance = userQuota < balanceCost
  const limitReached =
    (props.purchaseLimit || 0) > 0 &&
    (props.purchaseCount || 0) >= (props.purchaseLimit || 0)
  const estimatedExpiry = estimatePlanEndTime(plan)

  const handlePayStripe = async () => {
    setPaying(true)
    try {
      const res = await paySubscriptionStripe({ plan_id: plan.id })
      if (res.message === 'success' && res.data?.pay_link) {
        window.open(res.data.pay_link, '_blank')
        toast.success(t('Payment page opened'))
        props.onOpenChange(false)
      } else {
        handleServerError(res, t('Payment request failed'))
      }
    } catch (error) {
      handleServerError(error, t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  const handlePayCreem = async () => {
    setPaying(true)
    try {
      const res = await paySubscriptionCreem({ plan_id: plan.id })
      if (res.message === 'success' && res.data?.checkout_url) {
        window.open(res.data.checkout_url, '_blank')
        toast.success(t('Payment page opened'))
        props.onOpenChange(false)
      } else {
        handleServerError(res, t('Payment request failed'))
      }
    } catch (error) {
      handleServerError(error, t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  // In-tab redirect (not window.open) — user-gesture context is lost
  // across the await, so a popup would be blocked. Same as the wallet hook.
  const handlePayWaffoPancake = async () => {
    setPaying(true)
    try {
      const res = await paySubscriptionWaffoPancake({ plan_id: plan.id })
      if (res.message === 'success' && res.data?.checkout_url) {
        toast.success(t('Redirecting to payment page...'))
        window.location.href = res.data.checkout_url
      } else {
        handleServerError(res, t('Payment request failed'))
      }
    } catch (error) {
      handleServerError(error, t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  const isSafari =
    typeof navigator !== 'undefined' &&
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

  const handlePayEpay = async () => {
    if (!selectedEpayMethod) {
      toast.error(t('Please select a payment method'))
      return
    }
    setPaying(true)
    try {
      const res = await paySubscriptionEpay({
        plan_id: plan.id,
        payment_method: selectedEpayMethod,
      })
      if (res.message === 'success' && res.url) {
        const form = document.createElement('form')
        form.action = res.url
        form.method = 'POST'
        if (!isSafari) {
          form.target = '_blank'
        }
        Object.entries(res.data || {}).forEach(([key, value]) => {
          const input = document.createElement('input')
          input.type = 'hidden'
          input.name = key
          input.value = String(value)
          form.appendChild(input)
        })
        document.body.appendChild(form)
        form.submit()
        document.body.removeChild(form)
        toast.success(t('Payment initiated'))
        props.onOpenChange(false)
      } else {
        handleServerError(res, t('Payment request failed'))
      }
    } catch (error) {
      handleServerError(error, t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  const handleAddFunds = () => {
    props.onOpenChange(false)
    void navigate({ to: '/wallet' })
  }

  const handlePayBalance = async () => {
    if (!allowBalancePay) {
      toast.error(t('This plan does not allow balance redemption'))
      return
    }
    setPaying(true)
    try {
      const res = await paySubscriptionBalance({ plan_id: plan.id })
      if (res.success) {
        toast.success(
          res.data?.renewed
            ? t('Subscription renewed successfully')
            : t('Subscription purchased successfully')
        )
        void props.onPurchaseSuccess?.()
        props.onOpenChange(false)
      } else {
        handleServerError(res, t('Payment request failed'))
      }
    } catch (error) {
      if (getServerErrorStatus(error) === 409) {
        toast.error(
          t(
            'You already have an active subscription for another plan. Wait until it expires or ask an administrator to cancel it before purchasing this plan.'
          )
        )
      } else {
        handleServerError(error, t('Payment request failed'))
      }
    } finally {
      setPaying(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <Crown className='h-5 w-5' />
          {t('Purchase Subscription')}
        </>
      }
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-lg'
      titleClassName='flex items-center gap-2'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <div className='space-y-4'>
        <div className='bg-muted/40 space-y-3 rounded-xl border p-4'>
          <div className='flex justify-between gap-4'>
            <span className='text-muted-foreground text-sm'>
              {t('Plan Name')}
            </span>
            <span className='max-w-[260px] truncate text-sm font-medium'>
              {plan.title}
            </span>
          </div>
          <div className='flex items-center justify-between gap-4'>
            <span className='text-muted-foreground text-sm'>
              {t('Validity Period')}
            </span>
            <span className='flex items-center gap-1.5 text-sm'>
              <CalendarClock className='h-3.5 w-3.5' />
              {formatDuration(plan, t)}
            </span>
          </div>
          <div className='flex items-center justify-between gap-4'>
            <span className='text-muted-foreground text-sm'>
              {t('Effective Time')}
            </span>
            <span className='text-sm'>{t('Immediately upon payment')}</span>
          </div>
          {estimatedExpiry && (
            <div className='flex items-center justify-between gap-4'>
              <span className='text-muted-foreground text-sm'>
                {t('Estimated Expiry')}
              </span>
              <span className='text-sm tabular-nums'>{estimatedExpiry}</span>
            </div>
          )}
          {formatResetPeriod(plan, t) !== t('No Reset') && (
            <div className='flex justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Reset Period')}
              </span>
              <span className='text-sm'>{formatResetPeriod(plan, t)}</span>
            </div>
          )}
          {hasQuotaWindows ? (
            <div className='space-y-1.5'>
              <span className='text-muted-foreground text-sm'>
                {t('Rolling Quota Windows')}
              </span>
              {quotaWindows.map((window) => (
                <div
                  key={window.window_seconds}
                  className='flex items-center justify-between text-sm'
                >
                  <span>{formatWindowDuration(window.window_seconds, t)}</span>
                  <span className='flex items-center gap-1 tabular-nums'>
                    <Package className='h-3.5 w-3.5' />
                    {formatQuota(window.quota_limit)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Plan Quota')}
              </span>
              <span className='flex items-center gap-1 text-sm'>
                <Package className='h-3.5 w-3.5' />
                {totalAmount > 0 ? formatQuota(totalAmount) : t('Unlimited')}
              </span>
            </div>
          )}
          {(plan.max_concurrency || 0) > 0 && (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Account Concurrency')}
              </span>
              <span className='text-sm'>{plan.max_concurrency}</span>
            </div>
          )}
          <div className='flex items-center justify-between gap-3'>
            <span className='text-muted-foreground text-sm'>
              {t('Max Output Tokens per Request')}
            </span>
            <span className='text-sm tabular-nums'>
              {formatNumber(plan.max_output_tokens || 4096, locale)}
            </span>
          </div>
          {plan.upgrade_group && (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Upgrade Group')}
              </span>
              <GroupBadge group={plan.upgrade_group} />
            </div>
          )}
          {routeGroups.length > 0 && (
            <div className='space-y-2 pt-0.5'>
              <span className='text-muted-foreground block text-sm'>
                {t('Plan Coverage Groups')}
              </span>
              <div className='bg-background rounded-lg border px-3 py-2'>
                <div className='text-muted-foreground mb-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-[11px] font-medium'>
                  <span>{t('Group')}</span>
                  <span className='text-right'>{t('Wallet Multiplier')}</span>
                  <span className='text-right'>{t('Plan Multiplier')}</span>
                </div>
                <div className='divide-border/60 divide-y'>
                  {routeGroups.map((group) => {
                    const walletRatio = props.groupRatioMap?.[group]
                    const configuredRatio = Number(
                      plan.route_group_ratios?.[group] || 0
                    )
                    const effectivePlanRatio =
                      configuredRatio > 0 ? configuredRatio : walletRatio
                    const hasDiscount =
                      typeof walletRatio === 'number' &&
                      typeof effectivePlanRatio === 'number' &&
                      effectivePlanRatio < walletRatio

                    return (
                      <div
                        key={group}
                        className='grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-1.5 text-xs first:pt-0 last:pb-0'
                      >
                        <div className='min-w-0'>
                          <div className='text-foreground truncate font-medium'>
                            {group}
                          </div>
                          {configuredRatio <= 0 && (
                            <div className='text-muted-foreground text-[11px]'>
                              {t('Inherits the normal group multiplier')}
                            </div>
                          )}
                        </div>
                        <span
                          className={cn(
                            'text-muted-foreground text-right tabular-nums',
                            hasDiscount && 'line-through opacity-75'
                          )}
                        >
                          {typeof walletRatio === 'number'
                            ? formatMultiplier(walletRatio, locale)
                            : '—'}
                        </span>
                        <span
                          className={cn(
                            'text-right font-semibold tabular-nums',
                            hasDiscount
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-foreground'
                          )}
                        >
                          {typeof effectivePlanRatio === 'number'
                            ? formatMultiplier(effectivePlanRatio, locale)
                            : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          <Separator />
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>{t('Amount Due')}</span>
            <span className='text-primary text-lg font-bold'>{price}</span>
          </div>
        </div>

        {routeGroups.length > 0 && (
          <Alert className='px-4 py-3'>
            <AlertDescription className='flex flex-col gap-2.5 text-xs leading-relaxed'>
              <p>
                {t(
                  'Use an API key set to one of these plan coverage groups, or use Auto with one of them included. The qualification group only controls your account group and multiplier; it does not route requests by itself.'
                )}
              </p>
              <div>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    props.onOpenChange(false)
                    void navigate({ to: '/keys' })
                  }}
                >
                  {t('Create an Auto group API Key')}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <p className='text-muted-foreground text-xs'>
          {t(
            'Subscriptions currently support OpenAI, Claude, Responses and Gemini text generation APIs. Other endpoints are unavailable with subscription funding.'
          )}
        </p>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Renewing the same plan extends the current expiry. Purchasing a different plan is available after the current plan expires or is cancelled by an administrator.'
          )}
        </p>

        {limitReached && (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('Purchase limit reached')} ({props.purchaseCount}/
              {props.purchaseLimit})
            </AlertDescription>
          </Alert>
        )}

        <div className='flex flex-col gap-2 rounded-md border p-3'>
          <div className='flex items-center justify-between gap-2 text-xs'>
            <span className='text-muted-foreground'>{t('Required')}</span>
            <span>{formatQuota(balanceCost)}</span>
          </div>
          <div className='flex items-center justify-between gap-2 text-xs'>
            <span className='text-muted-foreground'>{t('Available')}</span>
            <span>{formatQuota(userQuota)}</span>
          </div>
          {balanceCurrencyUnavailable && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t('Balance payment is available only for CNY plans')}
              </AlertDescription>
            </Alert>
          )}
          {!balanceCurrencyUnavailable && !allowBalancePay && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t('This plan does not allow balance redemption')}
              </AlertDescription>
            </Alert>
          )}
          {!balanceCurrencyUnavailable &&
            allowBalancePay &&
            insufficientBalance && (
              <Alert variant='destructive'>
                <AlertDescription className='flex flex-wrap items-center justify-between gap-2'>
                  <span>{t('Insufficient balance')}</span>
                  <Button size='sm' variant='outline' onClick={handleAddFunds}>
                    {t('Add Funds')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          <Button
            variant='outline'
            onClick={handlePayBalance}
            disabled={
              paying || limitReached || !allowBalancePay || insufficientBalance
            }
          >
            {t('Pay with Balance')}
          </Button>
        </div>

        {hasAnyPayment && (
          <div className='space-y-3'>
            <p className='text-muted-foreground text-xs'>
              {t('Select payment method')}
            </p>
            {(hasStripe || hasCreem || hasWaffoPancake) && (
              <div className='grid grid-cols-2 gap-2 sm:flex'>
                {hasStripe && (
                  <Button
                    variant='outline'
                    className='flex-1'
                    onClick={handlePayStripe}
                    disabled={paying || limitReached}
                  >
                    Stripe
                  </Button>
                )}
                {hasCreem && (
                  <Button
                    variant='outline'
                    className='flex-1'
                    onClick={handlePayCreem}
                    disabled={paying || limitReached}
                  >
                    Creem
                  </Button>
                )}
                {hasWaffoPancake && (
                  <Button
                    variant='outline'
                    className='flex-1'
                    onClick={handlePayWaffoPancake}
                    disabled={paying || limitReached}
                  >
                    Waffo Pancake
                  </Button>
                )}
              </div>
            )}
            {hasEpay && (
              <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
                <Combobox
                  options={(props.epayMethods || []).map((m) => ({
                    value: m.type,
                    label: m.name || m.type,
                  }))}
                  value={selectedEpayMethod}
                  onValueChange={(v) => v !== null && setSelectedEpayMethod(v)}
                  disabled={limitReached}
                  className='flex-1'
                />
                <Button
                  onClick={handlePayEpay}
                  disabled={paying || !selectedEpayMethod || limitReached}
                >
                  {t('Pay')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
