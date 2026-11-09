import { useTranslation } from 'react-i18next'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { formatPlanPrice } from '@/features/subscriptions/lib'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import { formatOverviewMoney } from '../lib/format'
import type { SubscriptionOverviewPlan } from '../types'

interface PlanBreakdownProps {
  plans?: SubscriptionOverviewPlan[]
  loading: boolean
}

export function PlanBreakdown(props: PlanBreakdownProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const plans = props.plans ?? []

  return (
    <PanelWrapper
      title={t('Plan breakdown')}
      description={t(
        'Range revenue and consumed cost, plus the remaining quota of active subscriptions.'
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
            <TableHead className='min-w-40'>{t('Plan')}</TableHead>
            <TableHead className='text-right'>{t('Orders')}</TableHead>
            <TableHead className='text-right'>{t('Order revenue')}</TableHead>
            <TableHead className='text-right'>{t('Consumed quota')}</TableHead>
            <TableHead className='text-right'>{t('Upstream cost')}</TableHead>
            <TableHead className='text-right'>{t('Gross profit')}</TableHead>
            <TableHead className='text-right'>
              {t('Active subscriptions')}
            </TableHead>
            <TableHead className='text-right'>{t('Remaining quota')}</TableHead>
            <TableHead className='text-right'>
              {t('Remaining cost exposure')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.map((plan) => (
            <TableRow key={plan.plan_id}>
              <TableCell>
                <div className='flex flex-col gap-0.5'>
                  <span className='font-medium'>{plan.title}</span>
                  <span className='text-muted-foreground text-xs'>
                    {formatPlanPrice(plan.price_amount, plan.currency, locale)}
                    {plan.enabled ? null : ` · ${t('Disabled')}`}
                  </span>
                </div>
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatNumber(plan.order_count, locale)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatOverviewMoney(plan.revenue, locale)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatQuota(plan.consumed_quota)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatOverviewMoney(plan.consumed_cost, locale)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatOverviewMoney(plan.gross_profit, locale)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatNumber(plan.active_subscriptions, locale)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatQuota(plan.remaining_quota)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatOverviewMoney(plan.remaining_cost, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PanelWrapper>
  )
}
