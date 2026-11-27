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
import { Crown, ReceiptText, RefreshCw, Sparkles, Check, Wallet } from 'lucide-react'
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
import { Card, CardContent } from '@/components/ui/card'
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
  formatMultiplier,
  formatPlanPrice,
  formatResetPeriod,
  formatWindowDuration,
} from '@/features/subscriptions/lib'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { toIntlLocale } from '@/i18n/languages'
import { getUserGroups } from '@/lib/api'
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
  const [groupRatioMap, setGroupRatioMap] = useState<Record<string, number>>(
    {}
  )
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

  const fetchUserGroups = useCallback(async () => {
    try {
      const res = await getUserGroups()
      if (res.success && res.data) {
        const nextMap: Record<string, number> = {}
        for (const [groupName, info] of Object.entries(res.data)) {
          const ratio = Number(info?.ratio)
          if (Number.isFinite(ratio) && ratio > 0) {
            nextMap[groupName] = ratio
          }
        }
        setGroupRatioMap(nextMap)
      }
    } catch {
      // Optional enrichment: keep plan cards functional if group ratios fail to load.
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([
        fetchPlans(),
        fetchSelfSubscription(),
        fetchUserGroups(),
      ])
      setLoading(false)
    }
    init()
  }, [fetchPlans, fetchSelfSubscription, fetchUserGroups])

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
      <div className='space-y-6'>
        <Skeleton className='h-14 w-full rounded-xl' />
        <div className='grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3'>
          {['first', 'second', 'third'].map((key) => (
            <Skeleton key={key} className='h-80 w-full rounded-xl' />
          ))}
        </div>
      </div>
    )
  }

  const subscriptionOverview = (
    <div
      className={cn(
        !hasAny &&
          'bg-card rounded-xl border px-4 py-3 shadow-xs sm:px-5 sm:py-3.5'
      )}
    >
      <div className='flex flex-wrap items-center justify-between gap-2.5 sm:gap-3'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          {!hasAny && (
            <div className='flex items-center gap-2'>
              <Crown className='text-amber-500 h-4 w-4 shrink-0' />
              <span className='text-sm font-medium'>
                {t('My Subscriptions')}
              </span>
            </div>
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
          {!hasAny && (
            <span className='text-muted-foreground hidden text-xs md:inline'>
              · {getBillingPreferenceDescription(billingPreference, t)}
            </span>
          )}
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
      {hasAny && (
        <p className='text-muted-foreground mt-2 text-xs leading-5'>
          {getBillingPreferenceDescription(billingPreference, t)}
        </p>
      )}
      {!hasAny && (
        <p className='text-muted-foreground mt-1.5 text-xs leading-5 md:hidden'>
          {getBillingPreferenceDescription(billingPreference, t)}
        </p>
      )}
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
                  className='bg-background space-y-4 rounded-xl border p-4 text-sm shadow-xs sm:p-5'
                >
                  <div className='flex flex-wrap items-start justify-between gap-3'>
                    <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
                      <span className='min-w-0 text-base font-semibold break-words'>
                        {planTitle
                          ? `${planTitle} · ${t('Subscription')} #${subscription?.id}`
                          : `${t('Subscription')} #${subscription?.id}`}
                      </span>
                      {statusBadge}
                    </div>
                    {isActive && (
                      <span className='bg-primary/10 text-primary shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums'>
                        {t('{{count}} days remaining', {
                          count: remainDays,
                        })}
                      </span>
                    )}
                  </div>

                  {hasQuotaWindows ? (
                    <div className='space-y-2'>
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
                            className='bg-muted/40 rounded-lg border p-3'
                          >
                            <div className='flex flex-wrap items-center justify-between gap-1'>
                              <span className='font-medium'>
                                {formatWindowDuration(window.window_seconds, t)}
                              </span>
                              <span className='text-muted-foreground text-xs tabular-nums'>
                                {formatQuota(window.used)}/
                                {formatQuota(window.quota_limit)} ·{' '}
                                {t('Remaining')} {formatQuota(window.remaining)}
                              </span>
                            </div>
                            <Progress
                              value={windowPercent}
                              className='mt-2 h-1.5'
                            />
                            {isActive && window.next_release_at > 0 && (
                              <div className='text-muted-foreground mt-1.5 text-xs'>
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
                    <div className='bg-muted/40 space-y-2 rounded-lg border p-3.5'>
                      <div className='flex flex-wrap items-baseline justify-between gap-2'>
                        <span className='text-muted-foreground text-xs font-medium'>
                          {t('Total Quota')}
                        </span>
                        <div className='text-xs tabular-nums'>
                          {totalAmount > 0 ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={<span className='cursor-help' />}
                              >
                                <span className='text-foreground font-semibold'>
                                  {t('Remaining')} {formatQuota(remainAmount)}
                                </span>
                                <span className='text-muted-foreground ml-2'>
                                  ({formatQuota(usedAmount)}/
                                  {formatQuota(totalAmount)} · {t('Used')}{' '}
                                  {usagePercent}%)
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t('Raw Quota')}: {usedAmount}/{totalAmount} ·{' '}
                                {t('Remaining')} {remainAmount}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className='text-foreground font-semibold'>
                              {t('Unlimited')}
                            </span>
                          )}
                        </div>
                      </div>
                      {totalAmount > 0 && isActive && (
                        <Progress value={usagePercent} className='h-2' />
                      )}
                    </div>
                  )}

                  <div className='grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3'>
                    <div className='bg-muted/25 rounded-lg border px-3 py-2'>
                      <div className='text-muted-foreground text-[11px]'>
                        {endTimeLabel}
                      </div>
                      <div className='mt-0.5 text-xs font-medium tabular-nums'>
                        {new Date(
                          (subscription?.end_time || 0) * 1000
                        ).toLocaleString(locale)}
                      </div>
                    </div>
                    {isActive && !hasQuotaWindows && nextResetTime > 0 && (
                      <div className='bg-muted/25 rounded-lg border px-3 py-2'>
                        <div className='text-muted-foreground text-[11px]'>
                          {t('Next reset')}
                        </div>
                        <div className='mt-0.5 text-xs font-medium tabular-nums'>
                          {new Date(nextResetTime * 1000).toLocaleString(
                            locale
                          )}
                        </div>
                      </div>
                    )}
                    {(subscription?.max_concurrency || 0) > 0 && (
                      <div className='bg-muted/25 rounded-lg border px-3 py-2'>
                        <div className='text-muted-foreground text-[11px]'>
                          {t('Account Concurrency')}
                        </div>
                        <div className='mt-0.5 text-xs font-medium tabular-nums'>
                          {subscription?.max_concurrency}
                        </div>
                      </div>
                    )}
                    <div className='bg-muted/25 rounded-lg border px-3 py-2'>
                      <div className='text-muted-foreground text-[11px]'>
                        {t('Max Output Tokens per Request')}
                      </div>
                      <div className='mt-0.5 text-xs font-medium tabular-nums'>
                        {formatNumber(
                          subscription?.max_output_tokens || 4096,
                          locale
                        )}
                      </div>
                    </div>
                  </div>

                  {(subscription?.route_groups || []).length > 0 && (
                    <div className='flex flex-wrap items-center gap-2 pt-0.5'>
                      <span className='text-muted-foreground text-xs'>
                        {t('Allowed Route Groups')}:
                      </span>
                      {(subscription?.route_groups || []).map((group) => {
                        const planRatio = Number(
                          subscription?.route_group_ratios?.[group] || 0
                        )
                        return (
                          <span
                            key={group}
                            className='bg-muted/30 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs'
                          >
                            <GroupBadge group={group} />
                            {planRatio > 0 && (
                              <span className='font-medium text-emerald-600 tabular-nums dark:text-emerald-400'>
                                {formatMultiplier(planRatio, locale)}
                              </span>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </>
      )}

      {!hasAny && null}
    </div>
  )

  return (
    <>
      <div className='space-y-6'>
        {hasAny ? (
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
        ) : (
          subscriptionOverview
        )}

        <section aria-label={t('Subscription Plans')} className='space-y-4'>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between'>
            <div>
              <h2 className='text-lg font-semibold tracking-tight'>
                {t('Subscription Plans')}
              </h2>
              <p className='text-muted-foreground text-sm'>
                {t('Subscribe to a plan for model access')}
              </p>
            </div>
            {typeof userQuota === 'number' && (
              <div className='bg-muted/50 inline-flex items-center gap-2 self-start rounded-lg border px-3 py-1.5 text-xs sm:self-auto'>
                <Wallet className='text-muted-foreground h-3.5 w-3.5 shrink-0' />
                <span className='text-muted-foreground'>
                  {t('Current Balance')}:
                </span>
                <span className='text-foreground font-semibold tabular-nums'>
                  {formatQuota(userQuota)}
                </span>
              </div>
            )}
          </div>

          {plans.length > 0 && (
            <div className='grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3'>
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
                const durationLabel = formatDuration(plan, t)
                const isPopular = index === 0 && plans.length > 1
                const limit = Number(plan.max_purchase_per_user || 0)
                const count = planPurchaseCountMap.get(plan.id) || 0
                const reached = limit > 0 && count >= limit

                let primaryQuotaLabel: string | null = null
                if (quotaWindows.length === 0) {
                  primaryQuotaLabel =
                    totalAmount > 0 ? formatQuota(totalAmount) : t('Unlimited')
                }

                const benefits = [
                  formatResetPeriod(plan, t) !== t('No Reset')
                    ? `${t('Quota Reset')}: ${formatResetPeriod(plan, t)}`
                    : null,
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
                ].filter(Boolean) as string[]
                const routeGroups = plan.route_groups || []

                return (
                  <Card
                    key={plan.id}
                    data-card-hover='false'
                    className={cn(
                      'relative flex flex-col overflow-hidden transition-shadow',
                      isPopular
                        ? 'border-primary/60 ring-primary/15 shadow-md ring-1'
                        : 'hover:border-border/80 shadow-xs'
                    )}
                  >
                    <CardContent className='flex h-full flex-col p-5 sm:p-6'>
                      <div className='mb-4 flex items-start justify-between gap-3'>
                        <div className='min-w-0 space-y-1'>
                          <h3 className='text-base font-semibold tracking-tight'>
                            {plan.title || t('Subscription Plans')}
                          </h3>
                          {plan.subtitle && (
                            <p className='text-muted-foreground line-clamp-2 text-xs leading-relaxed'>
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

                      <div className='mb-4 flex items-baseline gap-1.5'>
                        <span className='text-foreground text-3xl font-bold tracking-tight tabular-nums'>
                          {price}
                        </span>
                        <span className='text-muted-foreground text-xs'>
                          / {durationLabel}
                        </span>
                      </div>

                      {primaryQuotaLabel && (
                        <div className='bg-muted/50 mb-4 flex items-center justify-between rounded-lg border px-3.5 py-2.5'>
                          <span className='text-muted-foreground text-xs font-medium'>
                            {t('Total Quota')}
                          </span>
                          <span className='text-foreground text-sm font-semibold tabular-nums'>
                            {primaryQuotaLabel}
                          </span>
                        </div>
                      )}

                      <Separator className='mb-4' />

                      <div className='flex-1 space-y-2.5 pb-4'>
                        <div className='text-muted-foreground flex items-start gap-2 text-xs leading-5'>
                          <Check className='text-primary mt-0.5 h-3.5 w-3.5 shrink-0' />
                          <span>
                            {t('Validity Period')}: {durationLabel}
                          </span>
                        </div>
                        {benefits.map((label) => (
                          <div
                            key={label}
                            className='text-muted-foreground flex items-start gap-2 text-xs leading-5'
                          >
                            <Check className='text-primary mt-0.5 h-3.5 w-3.5 shrink-0' />
                            <span className='break-words'>{label}</span>
                          </div>
                        ))}
                      </div>

                      {routeGroups.length > 0 && (
                        <div className='bg-muted/30 mb-4 rounded-lg border p-3'>
                          <div className='text-muted-foreground mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-[11px] font-medium'>
                            <span>{t('Group')}</span>
                            <span className='text-right'>
                              {t('Wallet Multiplier')}
                            </span>
                            <span className='text-right'>
                              {t('Plan Multiplier')}
                            </span>
                          </div>
                          <div className='divide-border/60 divide-y'>
                            {routeGroups.map((group) => {
                              const walletRatio = groupRatioMap[group]
                              const configuredRatio = Number(
                                plan.route_group_ratios?.[group] || 0
                              )
                              const effectivePlanRatio =
                                configuredRatio > 0
                                  ? configuredRatio
                                  : walletRatio
                              const hasDiscount =
                                typeof walletRatio === 'number' &&
                                typeof effectivePlanRatio === 'number' &&
                                effectivePlanRatio < walletRatio

                              return (
                                <div
                                  key={group}
                                  className='grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-1.5 text-xs first:pt-0 last:pb-0'
                                >
                                  <span className='text-foreground truncate font-medium'>
                                    {group}
                                  </span>
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
                                      ? formatMultiplier(
                                          effectivePlanRatio,
                                          locale
                                        )
                                      : '—'}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

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
                          variant={isPopular ? 'default' : 'outline'}
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
        </section>
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
        groupRatioMap={groupRatioMap}
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
