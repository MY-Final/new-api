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

  return (
    <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
      <StatCard
        title={t('Order revenue')}
        value={formatOverviewMoney(summary?.revenue, locale)}
        description={t('Successful subscription orders in this range')}
        icon={ReceiptText}
        tone='accent-1'
        loading={props.loading}
        details={[
          {
            label: t('Orders'),
            value: formatNumber(summary?.order_count ?? 0, locale),
          },
        ]}
      />
      <StatCard
        title={t('Upstream cost')}
        value={formatOverviewMoney(summary?.consumed_cost, locale)}
        description={t('Consumed quota × upstream ratio')}
        icon={Coins}
        tone='accent-3'
        loading={props.loading}
        details={[
          {
            label: t('Consumed quota'),
            value: formatQuota(summary?.consumed_quota ?? 0),
          },
        ]}
      />
      <StatCard
        title={t('Gross profit')}
        value={formatOverviewMoney(summary?.gross_profit, locale)}
        description={t('Cash basis: revenue minus consumed cost')}
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
        ]}
      />
      <StatCard
        title={t('Remaining cost exposure')}
        value={formatOverviewMoney(summary?.remaining_cost, locale)}
        description={t('If every active subscriber uses the rest of quota')}
        icon={AlertTriangle}
        tone='accent-2'
        loading={props.loading}
      />
    </div>
  )
}
