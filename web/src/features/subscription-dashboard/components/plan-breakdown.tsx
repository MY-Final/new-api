import { AlertTriangle, ChevronDown, Users } from 'lucide-react'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { formatMultiplier, formatPlanPrice } from '@/features/subscriptions/lib'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatPercent, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { formatOverviewMoney } from '../lib/format'
import type {
  SubscriptionOverviewGroup,
  SubscriptionOverviewPlan,
} from '../types'

interface PlanBreakdownProps {
  plans?: SubscriptionOverviewPlan[]
  loading: boolean
  onViewSubscribers?: (plan: SubscriptionOverviewPlan) => void
}

function groupCostSourceLabel(
  t: ReturnType<typeof useTranslation>['t'],
  source: SubscriptionOverviewGroup['cost_ratio_source']
) {
  switch (source) {
    case 'snapshot':
      return t('Snapshot')
    case 'partial':
      return t('Partial')
    default:
      return t('Unattributed')
  }
}

function remainingRatioSourceLabel(
  t: ReturnType<typeof useTranslation>['t'],
  source: SubscriptionOverviewPlan['remaining_cost_ratio_source']
) {
  switch (source) {
    case 'consumption':
      return t('Consumption')
    case 'configured':
      return t('Configured max')
    case 'partial':
      return t('Configured max (partial)')
    default:
      return t('Unconfigured')
  }
}

export function PlanBreakdown(props: PlanBreakdownProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const plans = props.plans ?? []
  const [expandedPlanIds, setExpandedPlanIds] = useState<number[]>([])

  const togglePlan = (planId: number) => {
    setExpandedPlanIds((current) =>
      current.includes(planId)
        ? current.filter((id) => id !== planId)
        : [...current, planId]
    )
  }

  return (
    <PanelWrapper
      title={t('Plan breakdown')}
      description={t(
        'Range revenue and settled route-group cost, plus the remaining quota of active subscriptions.'
      )}
      loading={props.loading}
      empty={plans.length === 0}
      emptyMessage={t('No subscription plans yet')}
      height='h-auto'
      contentClassName='overflow-x-auto'
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='w-10'>
              <span className='sr-only'>{t('Route group costs')}</span>
            </TableHead>
            <TableHead className='min-w-40'>{t('Plan')}</TableHead>
            <TableHead className='text-right'>{t('Orders')}</TableHead>
            <TableHead className='text-right'>{t('Order revenue')}</TableHead>
            <TableHead className='text-right'>{t('Consumed quota')}</TableHead>
            <TableHead className='text-right'>
              {t('Estimated upstream cost')}
            </TableHead>
            <TableHead className='text-right'>
              {t('Estimated gross profit')}
            </TableHead>
            <TableHead className='text-right'>
              {t('Active subscriptions')}
            </TableHead>
            <TableHead className='text-right'>{t('Remaining quota')}</TableHead>
            <TableHead className='text-right'>
              {t('Estimated remaining cost')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.map((plan) => {
            const expanded = expandedPlanIds.includes(plan.plan_id)
            const hasGroups = plan.groups.length > 0
            return (
              <Fragment key={plan.plan_id}>
                <TableRow>
                  <TableCell>
                    {hasGroups ? (
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        aria-expanded={expanded}
                        aria-label={
                          expanded
                            ? t('Hide route group costs')
                            : t('Show route group costs')
                        }
                        onClick={() => togglePlan(plan.plan_id)}
                      >
                        <ChevronDown
                          className={cn(
                            'size-4 transition-transform',
                            expanded && 'rotate-180'
                          )}
                        />
                      </Button>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className='flex flex-col gap-0.5'>
                      <span className='font-medium'>{plan.title}</span>
                      <span className='text-muted-foreground text-xs'>
                        {formatPlanPrice(
                          plan.price_amount,
                          plan.currency,
                          locale
                        )}
                        {plan.enabled ? null : ` · ${t('Disabled')}`}
                      </span>
                      {plan.configured_quota_usd > 0 && (
                        <span className='text-muted-foreground text-xs'>
                          {t('Quota value')}:{' '}
                          {formatOverviewMoney(
                            plan.configured_quota_usd,
                            locale
                          )}
                        </span>
                      )}
                      {!plan.currency_supported && (
                        <span className='text-warning flex items-center gap-1 text-xs'>
                          <AlertTriangle className='size-3 shrink-0' />
                          {t('Revenue excluded: unsupported currency')}
                        </span>
                      )}
                      {plan.quota_below_price && (
                        <span className='text-warning flex items-center gap-1 text-xs'>
                          <AlertTriangle className='size-3 shrink-0' />
                          {t('Quota below price at current exchange rate')}
                        </span>
                      )}
                      {plan.unconfigured_cost_ratio_groups.length > 0 && (
                        <span className='text-warning flex items-start gap-1 text-xs'>
                          <AlertTriangle className='mt-0.5 size-3 shrink-0' />
                          {t(
                            'Upstream cost ratio is not configured for: {{groups}}. Cost and profit exclude these route groups.',
                            {
                              groups:
                                plan.unconfigured_cost_ratio_groups.join(', '),
                            }
                          )}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatNumber(plan.order_count, locale)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    <div className='flex flex-col items-end gap-0.5'>
                      <span>
                        {formatOverviewMoney(plan.revenue_usd, locale)}
                      </span>
                      {plan.cash_revenue_usd > 0 ||
                      plan.balance_revenue_usd > 0 ? (
                        <span className='text-muted-foreground text-[11px]'>
                          {t('Cash')}{' '}
                          {formatOverviewMoney(plan.cash_revenue_usd, locale)} ·{' '}
                          {t('Balance')}{' '}
                          {formatOverviewMoney(
                            plan.balance_revenue_usd,
                            locale
                          )}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatQuota(plan.consumed_quota)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    <div className='flex flex-col items-end gap-0.5'>
                      <span>
                        {formatOverviewMoney(plan.consumed_cost_usd, locale)}
                      </span>
                      {plan.unattributed_quota > 0 && (
                        <span className='text-warning text-[11px]'>
                          {t('Unattributed')}{' '}
                          {formatQuota(plan.unattributed_quota)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatOverviewMoney(plan.gross_profit_usd, locale)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    <div className='flex flex-col items-end gap-1'>
                      <div className='flex items-center gap-1.5'>
                        <span>
                          {formatNumber(plan.active_subscriptions, locale)}
                        </span>
                        {props.onViewSubscribers ? (
                          <Button
                            variant='outline'
                            size='xs'
                            aria-label={t('View subscribers for {{plan}}', {
                              plan: plan.title,
                            })}
                            onClick={() => props.onViewSubscribers?.(plan)}
                          >
                            <Users className='size-3' />
                            {t('Subscribers')}
                          </Button>
                        ) : null}
                      </div>
                      {plan.unlimited_subscriptions > 0 && (
                        <span className='text-muted-foreground text-[11px]'>
                          {t('Unlimited')}{' '}
                          {formatNumber(plan.unlimited_subscriptions, locale)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatQuota(plan.remaining_quota)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    <div className='flex flex-col items-end gap-0.5'>
                      <span>
                        {formatOverviewMoney(plan.remaining_cost_usd, locale)}
                      </span>
                      <span className='text-muted-foreground text-[11px]'>
                        {plan.remaining_cost_ratio_source === 'unconfigured'
                          ? '—'
                          : formatMultiplier(
                              plan.remaining_cost_ratio,
                              locale
                            )}{' '}
                        ·{' '}
                        {remainingRatioSourceLabel(
                          t,
                          plan.remaining_cost_ratio_source
                        )}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
                {expanded && hasGroups ? (
                  <TableRow>
                    <TableCell colSpan={10} className='bg-muted/20 p-3'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('Route group')}</TableHead>
                            <TableHead className='text-right'>
                              {t('Consumed quota')}
                            </TableHead>
                            <TableHead className='text-right'>
                              {t('Effective cost ratio')}
                            </TableHead>
                            <TableHead className='text-right'>
                              {t('Cost')}
                            </TableHead>
                            <TableHead className='text-right'>
                              {t('Cost share')}
                            </TableHead>
                            <TableHead>{t('Cost source')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {plan.groups.map((group) => (
                            <TableRow key={group.group_name}>
                              <TableCell className='font-medium'>
                                {group.group_name}
                              </TableCell>
                              <TableCell className='text-right tabular-nums'>
                                <div className='flex flex-col items-end gap-0.5'>
                                  <span>
                                    {formatQuota(group.consumed_quota)}
                                  </span>
                                  {group.unattributed_quota > 0 && (
                                    <span className='text-warning text-[11px]'>
                                      {t('Unattributed')}{' '}
                                      {formatQuota(group.unattributed_quota)}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className='text-right tabular-nums'>
                                {group.cost_ratio_source === 'unattributed'
                                  ? '—'
                                  : formatMultiplier(
                                      group.effective_cost_ratio,
                                      locale
                                    )}
                              </TableCell>
                              <TableCell className='text-right tabular-nums'>
                                {formatOverviewMoney(
                                  group.consumed_cost_usd,
                                  locale
                                )}
                              </TableCell>
                              <TableCell className='text-right tabular-nums'>
                                {formatPercent(group.cost_share * 100, locale)}
                              </TableCell>
                              <TableCell className='text-muted-foreground'>
                                {groupCostSourceLabel(
                                  t,
                                  group.cost_ratio_source
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </PanelWrapper>
  )
}
