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
import { Crown, ReceiptText, RefreshCw, Sparkles, Check } from 'lucide-react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { GroupBadge } from '@/components/group-badge'
import {
  StatusBadge,
  dotColorMap,
  textColorMap,
} from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
  updateBillingPreference,
} from '@/features/subscriptions/api'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import { SubscriptionUsageDialog } from '@/features/subscriptions/components/dialogs/subscription-usage-dialog'
import {
  formatDuration,
  formatPlanPrice,
  formatResetPeriod,
  formatWindowDuration,
} from '@/features/subscriptions/lib'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import type { PaymentMethod, TopupInfo } from '../types'

interface SubscriptionPlansCardProps {
  topupInfo: TopupInfo | null
  userQuota?: number
  onPurchaseSuccess?: () => void | Promise<void>
}

function getEpayMethods(payMethods: PaymentMethod[] = []): PaymentMethod[] {
  return payMethods.filter(
    (m) => m?.type && m.type !== 'stripe' && m.type !== 'creem'
  )
}

function getBillingPreferenceLabel(
  preference: string,
  t: (key: string) => string
): string {
  switch (preference) {
    case 'subscription_first':
      return t('Subscription First')
    case 'wallet_first':
      return t('Wallet First')
    case 'subscription_only':
      return t('Subscription Only')
    case 'wallet_only':
      return t('Wallet Only')
    default:
      return preference
  }
}

function getBillingPreferenceDescription(
  preference: string,
  t: (key: string) => string
): string {
  switch (preference) {
    case 'subscription_first':
      return t(
        'Use the subscription first; fall back to wallet only when the plan allows it.'
      )
    case 'wallet_first':
      return t(
        'Use wallet first and fall back to the subscription if the wallet balance is insufficient.'
      )
    case 'subscription_only':
      return t(
        'Use only the subscription and reject requests when it cannot cover the cost.'
      )
    case 'wallet_only':
      return t(
        'Use only wallet at the normal route multiplier; subscription quota is not consumed.'
      )
    default:
      return ''
  }
}

export function SubscriptionPlansCard({
  topupInfo,
  userQuota,
  onPurchaseSuccess,
}: SubscriptionPlansCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [activeSubscriptions, setActiveSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [billingPreference, setBillingPreference] =
    useState('subscription_first')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)
  const [usageDialogOpen, setUsageDialogOpen] = useState(false)

  const enableStripe = !!topupInfo?.enable_stripe_topup
  const enableCreem = !!topupInfo?.enable_creem_topup
  const enableWaffoPancake = !!topupInfo?.enable_waffo_pancake_topup
  const enableOnlineTopUp = !!topupInfo?.enable_online_topup
  const epayMethods = useMemo(
    () => getEpayMethods(topupInfo?.pay_methods),
    [topupInfo?.pay_methods]
  )

  const fetchPlans = useCallback(async () => {
    try {
      const res = requireServerSuccess(await getPublicPlans())
      if (res.success) {
        setPlans(res.data || [])
      }
    } catch (error) {
      handleServerError(error)
      setPlans([])
    }
  }, [])

  const fetchSelfSubscription = useCallback(async () => {
    try {
      const res = requireServerSuccess(await getSelfSubscriptionFull())
      if (res.success && res.data) {
        setBillingPreference(
          res.data.billing_preference || 'subscription_first'
        )
        setActiveSubscriptions(res.data.subscriptions || [])
        setAllSubscriptions(res.data.all_subscriptions || [])
      }
    } catch (error) {
      handleServerError(error)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchPlans(), fetchSelfSubscription()])
      setLoading(false)
    }
    init()
  }, [fetchPlans, fetchSelfSubscription])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchSelfSubscription()
    } finally {
      setRefreshing(false)
    }
  }

  const handlePreferenceChange = async (pref: string) => {
    const previous = billingPreference
    setBillingPreference(pref)
    try {
      const res = await updateBillingPreference(pref)
      if (res.success) {
        toast.success(t('Updated successfully'))
        const normalized = res.data?.billing_preference || pref
        setBillingPreference(normalized)
      } else {
        handleServerError(res, t('Update failed'))
        setBillingPreference(previous)
      }
    } catch (error) {
      handleServerError(error, t('Request failed'))
      setBillingPreference(previous)
    }
  }

  const hasActive = activeSubscriptions.length > 0
  const hasAny = allSubscriptions.length > 0
  const disablePref = !hasActive
  const isSubPref =
    billingPreference === 'subscription_first' ||
    billingPreference === 'subscription_only'

  const planPurchaseCountMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const sub of allSubscriptions) {
      const planId = sub?.subscription?.plan_id
      if (!planId) continue
      map.set(planId, (map.get(planId) || 0) + 1)
    }
    return map
  }, [allSubscriptions])

  const planTitleMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of plans) {
      if (p?.plan?.id) {
        map.set(p.plan.id, p.plan.title || '')
      }
    }
    return map
  }, [plans])

  const getRemainingDays = (sub: UserSubscriptionRecord) => {
    const endTime = sub?.subscription?.end_time || 0
    if (!endTime) return 0
    const now = Date.now() / 1000
    return Math.max(0, Math.ceil((endTime - now) / 86400))
  }

  const getUsagePercent = (sub: UserSubscriptionRecord) => {
    const total = Number(sub?.subscription?.amount_total || 0)
    const used = Number(sub?.subscription?.amount_used || 0)
    if (total <= 0) return 0
    return Math.round((used / total) * 100)
  }

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
          <Skeleton className='h-6 w-32' />
        </CardHeader>
        <CardContent className='space-y-4 p-3 sm:p-5'>
          <Skeleton className='h-20 w-full' />
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'>
            {['first', 'second', 'third'].map((key) => (
              <Skeleton key={key} className='h-48 w-full' />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const subscriptionOverview = (
    <div className={cn(!hasAny && 'rounded-xl border p-3 sm:p-4')}>
      <div className='flex flex-wrap items-center justify-between gap-2.5 sm:gap-3'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          {!hasAny && (
            <span className='text-sm font-medium'>{t('My Subscriptions')}</span>
          )}
          <span className='flex items-center gap-1.5 text-xs font-medium'>
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                hasActive ? dotColorMap.success : dotColorMap.neutral
              )}
              aria-hidden='true'
            />
            {hasActive ? (
              <span className={cn(textColorMap.success)}>
                {activeSubscriptions.length} {t('active')}
              </span>
            ) : (
              <span className='text-muted-foreground'>{t('No Active')}</span>
            )}
            {allSubscriptions.length > activeSubscriptions.length && (
              <>
                <span className='text-muted-foreground/30'>·</span>
                <span className='text-muted-foreground'>
                  {allSubscriptions.length - activeSubscriptions.length}{' '}
                  {t('expired')}
                </span>
              </>
            )}
          </span>
        </div>
        <div className='flex w-full items-center gap-2 sm:w-auto'>
          <Select
            items={[
              {
                value: 'subscription_first',
                label: (
                  <>
                    {getBillingPreferenceLabel('subscription_first', t)}
                    {disablePref ? ` (${t('No Active')})` : ''}
                  </>
                ),
              },
              {
                value: 'wallet_first',
                label: getBillingPreferenceLabel('wallet_first', t),
              },
              {
                value: 'subscription_only',
                label: (
                  <>
                    {getBillingPreferenceLabel('subscription_only', t)}
                    {disablePref ? ` (${t('No Active')})` : ''}
                  </>
                ),
              },
              {
                value: 'wallet_only',
                label: getBillingPreferenceLabel('wallet_only', t),
              },
            ]}
            value={billingPreference}
            onValueChange={(v) => v !== null && handlePreferenceChange(v)}
          >
            <SelectTrigger
              aria-label={t('Billing Preference')}
              className='h-8 flex-1 text-xs sm:w-[140px] sm:flex-none'
            >
              <SelectValue>
                {getBillingPreferenceLabel(billingPreference, t)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value='subscription_first' disabled={disablePref}>
                  {getBillingPreferenceLabel('subscription_first', t)}
                  {disablePref ? ` (${t('No Active')})` : ''}
                </SelectItem>
                <SelectItem value='wallet_first'>
                  {getBillingPreferenceLabel('wallet_first', t)}
                </SelectItem>
                <SelectItem value='subscription_only' disabled={disablePref}>
                  {getBillingPreferenceLabel('subscription_only', t)}
                  {disablePref ? ` (${t('No Active')})` : ''}
                </SelectItem>
                <SelectItem value='wallet_only'>
                  {getBillingPreferenceLabel('wallet_only', t)}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {hasAny && (
            <Button
              variant='outline'
              size='sm'
              className='h-8 shrink-0 gap-1.5 px-2.5'
              onClick={() => setUsageDialogOpen(true)}
              aria-label={t('Usage Records')}
            >
              <ReceiptText className='h-3.5 w-3.5' />
              <span className='hidden sm:inline'>{t('Usage Records')}</span>
            </Button>
          )}
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label={t('Refresh')}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            />
          </Button>
        </div>
      </div>

      {disablePref && isSubPref && (
        <p className='text-muted-foreground mt-2 text-xs'>
          {billingPreference === 'subscription_only'
            ? t(
                'Preference saved as {{pref}}, but no active subscription. Requests will be rejected.',
                { pref: t('Subscription Only') }
              )
            : t(
                'Preference saved as {{pref}}, but no active subscription. Wallet will be used automatically.',
                { pref: t('Subscription First') }
              )}
        </p>
      )}
      <p className='text-muted-foreground mt-2 text-xs leading-5'>
        {getBillingPreferenceDescription(billingPreference, t)}
      </p>
      {hasActive && (
        <p className='text-muted-foreground mt-2 text-xs leading-5'>
          {t(
            'Subscription payments use each plan route multiplier. Wallet payments use the normal route multiplier and do not consume subscription quota.'
          )}
        </p>
      )}

      {hasAny && (
        <>
          <Separator className='my-3' />
          <div
            className={cn(
              'grid grid-cols-1 items-start gap-3',
              allSubscriptions.length > 1 && 'lg:grid-cols-2'
            )}
          >
            {allSubscriptions.map((sub) => {
              const subscription = sub.subscription
              const totalAmount = Number(subscription?.amount_total || 0)
              const usedAmount = Number(subscription?.amount_used || 0)
              const remainAmount =
                totalAmount > 0 ? Math.max(0, totalAmount - usedAmount) : 0
              const quotaWindows = subscription?.quota_windows || []
              const hasQuotaWindows = quotaWindows.length > 0
              const planTitle = planTitleMap.get(subscription?.plan_id) || ''
              const remainDays = getRemainingDays(sub)
              const usagePercent = getUsagePercent(sub)
              const now = Date.now() / 1000
              const isExpired = (subscription?.end_time || 0) < now
              const isCancelled = subscription?.status === 'cancelled'
              const isActive = subscription?.status === 'active' && !isExpired
              const nextResetTime = subscription?.next_reset_time ?? 0
              let statusBadge = (
                <StatusBadge
                  label={t('Expired')}
                  variant='neutral'
                  copyable={false}
                />
              )
              if (isActive) {
                statusBadge = (
                  <StatusBadge
                    label={t('Active')}
                    variant='success'
                    copyable={false}
                  />
                )
              } else if (isCancelled) {
                statusBadge = (
                  <StatusBadge
                    label={t('Cancelled')}
                    variant='neutral'
                    copyable={false}
                  />
                )
              }

              let endTimeLabel = t('Expired at')
              if (isActive) {
                endTimeLabel = t('Until')
              } else if (isCancelled) {
                endTimeLabel = t('Cancelled at')
              }

              return (
                <article
                  key={subscription?.id}
                  className='bg-background rounded-lg border p-4 text-sm'
                >
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
                      <span className='min-w-0 font-medium break-words'>
                        {planTitle
                          ? `${planTitle} · ${t('Subscription')} #${subscription?.id}`
                          : `${t('Subscription')} #${subscription?.id}`}
                      </span>
                      {statusBadge}
                    </div>
                    {isActive && (
                      <span className='text-muted-foreground'>
                        {t('{{count}} days remaining', {
                          count: remainDays,
                        })}
                      </span>
                    )}
                  </div>
                  <div className='text-muted-foreground mt-1.5'>
                    {endTimeLabel}{' '}
                    {new Date(
                      (subscription?.end_time || 0) * 1000
                    ).toLocaleString(locale)}
                  </div>
                  {isActive && !hasQuotaWindows && nextResetTime > 0 && (
                    <div className='text-muted-foreground mt-1'>
                      {t('Next reset')}:{' '}
                      {new Date(nextResetTime * 1000).toLocaleString(locale)}
                    </div>
                  )}
                  {(subscription?.max_concurrency || 0) > 0 && (
                    <div className='text-muted-foreground mt-1'>
                      {t('Account Concurrency')}:{' '}
                      {subscription?.max_concurrency}
                    </div>
                  )}
                  <div className='text-muted-foreground mt-1'>
                    {t('Max Output Tokens per Request')}:{' '}
                    {formatNumber(
                      subscription?.max_output_tokens || 4096,
                      locale
                    )}
                  </div>
                  {(subscription?.route_groups || []).length > 0 && (
                    <div className='mt-1 flex flex-wrap items-center gap-1.5'>
                      <span className='text-muted-foreground'>
                        {t('Allowed Route Groups')}:
                      </span>
                      {(subscription?.route_groups || []).map((group) => (
                        <span
                          key={group}
                          className='inline-flex items-center gap-1'
                        >
                          <GroupBadge group={group} />
                          {(subscription?.route_group_ratios?.[group] || 0) >
                            0 && (
                            <span className='text-muted-foreground'>
                              ×{' '}
                              {formatNumber(
                                subscription?.route_group_ratios?.[group] || 0,
                                locale
                              )}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {hasQuotaWindows ? (
                    <div className='mt-2 space-y-2'>
                      {quotaWindows.map((window) => {
                        const windowPercent =
                          window.quota_limit > 0
                            ? Math.min(
                                100,
                                Math.round(
                                  (window.used / window.quota_limit) * 100
                                )
                              )
                            : 0
                        return (
                          <div
                            key={`${window.window_seconds}-${window.sort_order}`}
                            className='bg-muted/40 rounded-md p-2'
                          >
                            <div className='flex flex-wrap items-center justify-between gap-1'>
                              <span className='font-medium'>
                                {formatWindowDuration(window.window_seconds, t)}
                              </span>
                              <span className='text-muted-foreground tabular-nums'>
                                {formatQuota(window.used)}/
                                {formatQuota(window.quota_limit)} ·{' '}
                                {t('Remaining')} {formatQuota(window.remaining)}
                              </span>
                            </div>
                            <Progress
                              value={windowPercent}
                              className='mt-1.5 h-1'
                            />
                            {isActive && window.next_release_at > 0 && (
                              <div className='text-muted-foreground mt-1'>
                                {t('Next release')}:{' '}
                                {new Date(
                                  window.next_release_at * 1000
                                ).toLocaleString(locale)}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <>
                      <div className='text-muted-foreground mt-1'>
                        {t('Total Quota')}:{' '}
                        {totalAmount > 0 ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={<span className='cursor-help' />}
                            >
                              {formatQuota(usedAmount)}/
                              {formatQuota(totalAmount)} · {t('Remaining')}{' '}
                              {formatQuota(remainAmount)}
                            </TooltipTrigger>
                            <TooltipContent>
                              {t('Raw Quota')}: {usedAmount}/{totalAmount} ·{' '}
                              {t('Remaining')} {remainAmount}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          t('Unlimited')
                        )}
                        {totalAmount > 0 && (
                          <span className='ml-2'>
                            {t('Used')} {usagePercent}%
                          </span>
                        )}
                      </div>
                      {totalAmount > 0 && isActive && (
                        <Progress value={usagePercent} className='mt-2 h-1.5' />
                      )}
                    </>
                  )}
                </article>
              )
            })}
          </div>
        </>
      )}

      {!hasAny && (
        <p className='text-muted-foreground mt-2 text-xs'>
          {t('Subscribe to a plan for model access')}
        </p>
      )}
    </div>
  )

  return (
    <>
      <div className='space-y-4 sm:space-y-5'>
        {hasAny && (
          <section aria-label={t('My Subscriptions')}>
            <TitledCard
              title={t('My Subscriptions')}
              icon={<Crown className='h-4 w-4' />}
              iconTone='warning'
              disableHoverEffect
            >
              {subscriptionOverview}
            </TitledCard>
          </section>
        )}
        <TitledCard
          title={t('Subscription Plans')}
          description={t('Subscribe to a plan for model access')}
          icon={<Crown className='h-4 w-4' />}
          iconTone='warning'
          disableHoverEffect
          contentClassName='space-y-4 sm:space-y-5'
        >
          {!hasAny && subscriptionOverview}
          {plans.length > 0 && (
            <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'>
              {plans.map((p, index) => {
                const plan = p?.plan
                if (!plan) return null
                const totalAmount = Number(plan.total_amount || 0)
                const quotaWindows = plan.quota_windows || []
                const price = formatPlanPrice(
                  Number(plan.price_amount || 0),
                  plan.currency,
                  locale
                )
                const isPopular = index === 0 && plans.length > 1
                const limit = Number(plan.max_purchase_per_user || 0)
                const count = planPurchaseCountMap.get(plan.id) || 0
                const reached = limit > 0 && count >= limit

                let totalQuotaBenefit: string | null = null
                if (quotaWindows.length === 0) {
                  const quotaLabel =
                    totalAmount > 0 ? formatQuota(totalAmount) : t('Unlimited')
                  totalQuotaBenefit = `${t('Total Quota')}: ${quotaLabel}`
                }

                const benefits = [
                  `${t('Validity Period')}: ${formatDuration(plan, t)}`,
                  formatResetPeriod(plan, t) !== t('No Reset')
                    ? `${t('Quota Reset')}: ${formatResetPeriod(plan, t)}`
                    : null,
                  totalQuotaBenefit,
                  ...quotaWindows.map(
                    (window) =>
                      `${formatWindowDuration(window.window_seconds, t)}: ${formatQuota(window.quota_limit)}`
                  ),
                  (plan.max_concurrency || 0) > 0
                    ? `${t('Account Concurrency')}: ${plan.max_concurrency}`
                    : null,
                  `${t('Max Output Tokens per Request')}: ${formatNumber(plan.max_output_tokens || 4096, locale)}`,
                  limit > 0 ? `${t('Purchase Limit')}: ${limit}` : null,
                  plan.upgrade_group
                    ? `${t('Upgrade Group')}: ${plan.upgrade_group}`
                    : null,
                  (plan.route_groups || []).length > 0
                    ? `${t('Route Groups')}: ${(plan.route_groups || [])
                        .map((group) => {
                          const ratio = Number(
                            plan.route_group_ratios?.[group] || 0
                          )
                          return ratio > 0
                            ? `${group} × ${formatNumber(ratio, locale)}`
                            : group
                        })
                        .join(' · ')}`
                    : null,
                ].filter(Boolean) as string[]

                return (
                  <Card
                    key={plan.id}
                    data-card-hover='false'
                    className={cn(isPopular && 'border-primary/70 shadow-sm')}
                  >
                    <CardContent className='flex h-full flex-col p-3.5 sm:p-4'>
                      <div className='mb-2 flex items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <h4 className='truncate font-semibold'>
                            {plan.title || t('Subscription Plans')}
                          </h4>
                          {plan.subtitle && (
                            <p className='text-muted-foreground truncate text-xs'>
                              {plan.subtitle}
                            </p>
                          )}
                        </div>
                        {isPopular && (
                          <StatusBadge
                            variant='info'
                            copyable={false}
                            className='shrink-0'
                          >
                            <Sparkles className='h-3 w-3' />
                            {t('Recommended')}
                          </StatusBadge>
                        )}
                      </div>

                      <div className='py-2'>
                        <span className='text-primary text-2xl font-bold'>
                          {price}
                        </span>
                      </div>

                      <div className='flex-1 space-y-1.5 pb-3'>
                        {benefits.map((label) => (
                          <div
                            key={label}
                            className='text-muted-foreground flex items-center gap-2 text-xs'
                          >
                            <Check className='text-primary h-3 w-3 shrink-0' />
                            <span>{label}</span>
                          </div>
                        ))}
                      </div>

                      <Separator className='mb-3' />

                      {reached ? (
                        <Tooltip>
                          <TooltipTrigger render={<div />}>
                            <Button
                              variant='outline'
                              className='w-full'
                              disabled
                            >
                              {t('Limit Reached')}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t('Purchase limit reached')} ({count}/{limit})
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Button
                          variant='outline'
                          className='w-full'
                          onClick={() => {
                            setSelectedPlan(p)
                            setPurchaseOpen(true)
                          }}
                        >
                          {t('Subscribe Now')}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
          {plans.length === 0 && !hasAny && (
            <EmptyState
              icon={Crown}
              title={t('No plans available')}
              className='min-h-64'
            />
          )}
          {plans.length === 0 && hasAny && (
            <p className='text-muted-foreground py-4 text-center text-sm'>
              {t('No plans available')}
            </p>
          )}
        </TitledCard>
      </div>

      <SubscriptionPurchaseDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          setPurchaseOpen(open)
          if (!open) {
            fetchSelfSubscription()
          }
        }}
        plan={selectedPlan}
        enableStripe={enableStripe}
        enableCreem={enableCreem}
        enableWaffoPancake={enableWaffoPancake}
        enableOnlineTopUp={enableOnlineTopUp}
        epayMethods={epayMethods}
        userQuota={userQuota}
        onPurchaseSuccess={onPurchaseSuccess}
        purchaseLimit={
          selectedPlan?.plan?.max_purchase_per_user
            ? Number(selectedPlan.plan.max_purchase_per_user)
            : undefined
        }
        purchaseCount={
          selectedPlan?.plan?.id
            ? planPurchaseCountMap.get(selectedPlan.plan.id)
            : undefined
        }
      />
      <SubscriptionUsageDialog
        open={usageDialogOpen}
        onOpenChange={setUsageDialogOpen}
      />
    </>
  )
}
