import {
  AlertTriangle,
  Coins,
  ReceiptText,
  Sigma,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatPercent, formatQuota } from '@/lib/format'

import { formatOverviewMoney } from '../lib/format'
import type { SubscriptionOverviewTotals } from '../types'

interface SubscriptionOverviewCardsProps {
  summary?: SubscriptionOverviewTotals
  loading: boolean
}

export function SubscriptionOverviewCards(
  props: SubscriptionOverviewCardsProps
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const summary = props.summary
  const margin = (summary?.gross_margin ?? 0) * 100
  const attributedQuota = Math.max(
    (summary?.consumed_quota ?? 0) - (summary?.unattributed_quota ?? 0),
    0
  )

  return (
    <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
      <div className='bg-card min-w-0 rounded-2xl border p-4 shadow-xs sm:p-5'>
        <StatCard
          title={t('Order revenue')}
          value={formatOverviewMoney(summary?.revenue_usd, locale)}
          description={t('Successful subscription orders in this range')}
          icon={ReceiptText}
          tone='accent-1'
          loading={props.loading}
          details={[
            {
              label: t('Orders'),
              value: formatNumber(summary?.order_count ?? 0, locale),
            },
            {
              label: t('Cash revenue'),
              value: formatOverviewMoney(summary?.cash_revenue_usd, locale),
            },
            {
              label: t('Balance offset'),
              value: formatOverviewMoney(summary?.balance_revenue_usd, locale),
            },
          ]}
        />
      </div>
      <div className='bg-card min-w-0 rounded-2xl border p-4 shadow-xs sm:p-5'>
        <StatCard
          title={t('Estimated upstream cost')}
          value={formatOverviewMoney(summary?.consumed_cost_usd, locale)}
          description={t(
            'Settled charges priced with each route group’s cost ratio'
          )}
          icon={Coins}
          tone='accent-3'
          loading={props.loading}
          details={[
            {
              label: t('Consumed quota'),
              value: formatQuota(summary?.consumed_quota ?? 0),
            },
            {
              label: t('Attributed quota'),
              value: formatQuota(attributedQuota),
            },
            ...((summary?.unattributed_quota ?? 0) > 0
              ? [
                  {
                    label: t('Unattributed quota'),
                    value: formatQuota(summary?.unattributed_quota ?? 0),
                  },
                ]
              : []),
          ]}
        />
      </div>
      <div className='bg-card min-w-0 rounded-2xl border p-4 shadow-xs sm:p-5'>
        <StatCard
          title={t('Estimated gross profit')}
          value={formatOverviewMoney(summary?.gross_profit_usd, locale)}
          description={t('Revenue minus attributed consumed cost')}
          icon={TrendingUp}
          tone='accent-2'
          loading={props.loading}
          details={[
            {
              label: t('Margin'),
              value: formatPercent(margin, locale),
            },
          ]}
        />
      </div>
      <div className='bg-card min-w-0 rounded-2xl border p-4 shadow-xs sm:p-5'>
        <StatCard
          title={t('Consumed quota')}
          value={formatQuota(summary?.consumed_quota ?? 0)}
          description={t('Quota consumed in this range')}
          icon={Sigma}
          tone='accent-3'
          loading={props.loading}
          details={[
            {
              label: t('Used of capacity'),
              value: formatQuota(summary?.used_quota ?? 0),
            },
          ]}
        />
      </div>
      <div className='bg-card min-w-0 rounded-2xl border p-4 shadow-xs sm:p-5'>
        <StatCard
          title={t('Active subscriptions')}
          value={formatNumber(summary?.active_subscriptions ?? 0, locale)}
          description={t('Subscriptions that can still consume quota')}
          icon={Users}
          tone='accent-1'
          loading={props.loading}
          details={[
            {
              label: t('Used of capacity'),
              value: formatQuota(summary?.used_quota ?? 0),
            },
            ...((summary?.reserved_quota ?? 0) > 0
              ? [
                  {
                    label: t('In progress'),
                    value: formatQuota(summary?.reserved_quota ?? 0),
                  },
                ]
              : []),
            {
              label: t('Remaining quota'),
              value: formatQuota(summary?.remaining_quota ?? 0),
            },
            ...((summary?.unlimited_subscriptions ?? 0) > 0
              ? [
                  {
                    label: t('Unlimited subscriptions'),
                    value: formatNumber(
                      summary?.unlimited_subscriptions ?? 0,
                      locale
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
      <div className='bg-card min-w-0 rounded-2xl border p-4 shadow-xs sm:p-5'>
        <StatCard
          title={t('Estimated remaining cost')}
          value={formatOverviewMoney(summary?.remaining_cost_usd, locale)}
          description={t('If every active subscriber uses the rest of quota')}
          icon={AlertTriangle}
          tone='accent-2'
          loading={props.loading}
        />
      </div>
    </div>
  )
}
