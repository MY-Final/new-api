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
import { Clock3, ShoppingBag, Undo2, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatCompactNumber,
  formatPercent,
  formatQuota,
  formatQuotaPrecise,
  resolveUserUsageBreakdown,
} from '@/lib/format'

import { formatPlanPrice } from '../lib'
import type {
  SubscriptionUsagePeriod,
  SubscriptionUsageStatistics,
} from '../types'
import { SubscriptionUsageChart } from './subscription-usage-chart'

const summarySkeletonKeys = ['total', 'today', 'week', 'month']
const detailSkeletonKeys = ['refunds', 'pending', 'purchases']

interface UsageTileProps {
  label: string
  value: string
  detail: string
  footnote: string
}

function UsageTile(props: UsageTileProps) {
  return (
    <div className='bg-card min-w-0 px-3 py-3 sm:px-4'>
      <div className='text-muted-foreground truncate text-[11px] font-medium tracking-wider uppercase'>
        {props.label}
      </div>
      <div className='mt-1.5 truncate font-mono text-lg font-bold tabular-nums sm:text-xl'>
        {props.value}
      </div>
      <div className='text-muted-foreground mt-1 truncate text-xs'>
        {props.detail}
      </div>
      <div className='text-muted-foreground/70 mt-0.5 truncate text-[11px]'>
        {props.footnote}
      </div>
    </div>
  )
}

interface DetailTileProps {
  icon: LucideIcon
  label: string
  value: string
  description: string
}

function DetailTile(props: DetailTileProps) {
  const Icon = props.icon

  return (
    <div className='rounded-lg border p-3'>
      <div className='text-muted-foreground flex items-center gap-2 text-xs font-medium'>
        <Icon className='size-4 shrink-0' aria-hidden='true' />
        <span className='truncate'>{props.label}</span>
      </div>
      <div className='mt-1.5 truncate font-mono text-base font-semibold tabular-nums'>
        {props.value}
      </div>
      <div className='text-muted-foreground mt-1 text-xs'>
        {props.description}
      </div>
    </div>
  )
}

function periodDetail(
  period: SubscriptionUsagePeriod,
  t: ReturnType<typeof useTranslation>['t']
): { detail: string; footnote: string } {
  return {
    detail: `${t('Wallet')}: ${formatQuota(period.wallet_quota)} · ${t('Subscription')}: ${formatQuota(period.subscription_quota)}`,
    footnote: t('{{value}} requests', {
      value: formatCompactNumber(period.request_count),
    }),
  }
}

interface SubscriptionUsageSummaryProps {
  statistics?: SubscriptionUsageStatistics
  loading: boolean
}

export function SubscriptionUsageSummary(props: SubscriptionUsageSummaryProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  if (props.loading) {
    return (
      <div className='space-y-3'>
        <div className='bg-border/60 grid grid-cols-2 gap-px overflow-hidden rounded-lg border lg:grid-cols-4'>
          {summarySkeletonKeys.map((key) => (
            <div key={key} className='bg-card space-y-2 px-3 py-3'>
              <Skeleton className='h-3 w-20' />
              <Skeleton className='h-6 w-28' />
              <Skeleton className='h-3 w-full' />
            </div>
          ))}
        </div>
        <Skeleton className='h-64 w-full rounded-lg' />
        <div className='grid gap-2 sm:grid-cols-3'>
          {detailSkeletonKeys.map((key) => (
            <Skeleton key={key} className='h-24 w-full rounded-lg' />
          ))}
        </div>
      </div>
    )
  }

  if (!props.statistics) return null

  const usage = resolveUserUsageBreakdown(props.statistics)
  const today = periodDetail(props.statistics.today, t)
  const last7Days = periodDetail(props.statistics.last_7_days, t)
  const last30Days = periodDetail(props.statistics.last_30_days, t)
  const purchaseSpend =
    props.statistics.subscription_purchase_spend
      .map((spend) => formatPlanPrice(spend.amount, spend.currency, locale))
      .join(' · ') || t('No purchase records')

  return (
    <div className='space-y-3'>
      <div className='bg-border/60 grid grid-cols-2 gap-px overflow-hidden rounded-lg border lg:grid-cols-4'>
        <UsageTile
          label={t('Total Usage')}
          value={formatQuota(usage.totalUsedQuota)}
          detail={`${t('Wallet')}: ${formatQuota(usage.walletUsedQuota)} (${formatPercent(usage.walletUsageRatio, locale)}) · ${t('Subscription')}: ${formatQuota(usage.subscriptionUsedQuota)} (${formatPercent(usage.subscriptionUsageRatio, locale)})`}
          footnote={t('{{value}} requests', {
            value: formatCompactNumber(usage.totalRequestCount),
          })}
        />
        <UsageTile
          label={t('Today')}
          value={formatQuota(props.statistics.today.quota)}
          detail={today.detail}
          footnote={today.footnote}
        />
        <UsageTile
          label={t('Last 7 Days')}
          value={formatQuota(props.statistics.last_7_days.quota)}
          detail={last7Days.detail}
          footnote={last7Days.footnote}
        />
        <UsageTile
          label={t('Last 30 Days')}
          value={formatQuota(props.statistics.last_30_days.quota)}
          detail={last30Days.detail}
          footnote={last30Days.footnote}
        />
      </div>

      <section className='overflow-hidden rounded-lg border'>
        <div className='flex flex-wrap items-center justify-between gap-1 border-b px-3 py-2'>
          <div className='text-sm font-medium'>{t('Usage Trend')}</div>
          <div className='text-muted-foreground text-xs'>
            {t('Last 30 days')} · {t('Net usage')}
          </div>
        </div>
        <SubscriptionUsageChart data={props.statistics.daily} />
      </section>

      <div className='grid gap-2 sm:grid-cols-3'>
        <DetailTile
          icon={Undo2}
          label={t('Refunds (30 days)')}
          value={formatQuotaPrecise(props.statistics.refunded_quota)}
          description={t('{{value}} refunded requests', {
            value: formatCompactNumber(props.statistics.refunded_request_count),
          })}
        />
        <DetailTile
          icon={Clock3}
          label={t('Pending settlement')}
          value={formatQuotaPrecise(props.statistics.pending_quota)}
          description={t('{{value}} pending requests', {
            value: formatCompactNumber(props.statistics.pending_request_count),
          })}
        />
        <DetailTile
          icon={ShoppingBag}
          label={t('Subscription purchases')}
          value={t('{{value}} purchases', {
            value: formatCompactNumber(
              props.statistics.subscription_purchase_count
            ),
          })}
          description={purchaseSpend}
        />
      </div>
    </div>
  )
}
