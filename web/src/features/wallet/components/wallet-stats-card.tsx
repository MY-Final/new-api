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
import {
  Activity,
  BarChart3,
  Crown,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatCompactNumber,
  formatPercent,
  formatQuota,
  formatQuotaPrecise,
  resolveUserUsageBreakdown,
} from '@/lib/format'

import type { UserWalletData } from '../types'

interface WalletStatsCardProps {
  user: UserWalletData | null
  loading?: boolean
}

export function WalletStatsCard(props: WalletStatsCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  if (props.loading) {
    return (
      <div className='bg-border/60 grid grid-cols-2 gap-px overflow-hidden rounded-lg border lg:grid-cols-5'>
        {['balance', 'total', 'wallet', 'subscription', 'requests'].map(
          (key) => (
            <div
              key={key}
              className='bg-card min-w-0 px-2.5 py-2.5 sm:px-5 sm:py-4'
            >
              <Skeleton className='h-3.5 w-full' />
              <Skeleton className='mt-2 h-6 w-full sm:h-7' />
              <Skeleton className='mt-1.5 hidden h-3.5 w-24 md:block' />
            </div>
          )
        )}
      </div>
    )
  }

  const walletQuota = props.user?.quota ?? 0
  const hasDebt = walletQuota < 0
  const displayedQuota = Math.abs(walletQuota)
  const bonusQuota = Math.max(props.user?.bonus_quota ?? 0, 0)
  const paidQuota = props.user?.paid_quota ?? 0
  const usage = resolveUserUsageBreakdown(props.user ?? {})
  const stats: {
    label: string
    value: string
    description: string
    icon: typeof WalletCards
    tone: IconBadgeTone
  }[] = [
    {
      label: hasDebt ? t('Debt') : t('Current Balance'),
      value: formatQuotaPrecise(displayedQuota),
      description: hasDebt
        ? t('Recharge to settle debt')
        : `${t('Bonus Balance')}: ${formatQuotaPrecise(bonusQuota)} · ${t('Paid Balance')}: ${formatQuotaPrecise(paidQuota)}`,
      icon: WalletCards,
      tone: hasDebt ? 'destructive' : 'success',
    },
    {
      label: t('Total Usage'),
      value: formatQuota(usage.totalUsedQuota),
      description: `${t('Wallet')}: ${formatQuota(usage.walletUsedQuota)} · ${t('Subscription')}: ${formatQuota(usage.subscriptionUsedQuota)}`,
      icon: TrendingUp,
      tone: 'chart-4',
    },
    {
      label: t('Wallet Usage'),
      value: formatQuota(usage.walletUsedQuota),
      description: t('{{percent}} of total usage', {
        percent: formatPercent(usage.walletUsageRatio, locale),
      }),
      icon: BarChart3,
      tone: 'info',
    },
    {
      label: t('Subscription Usage'),
      value: formatQuota(usage.subscriptionUsedQuota),
      description: t('{{percent}} of total usage', {
        percent: formatPercent(usage.subscriptionUsageRatio, locale),
      }),
      icon: Crown,
      tone: 'warning',
    },
    {
      label: t('API Requests'),
      value: formatCompactNumber(props.user?.request_count ?? 0),
      description: `${t('Wallet')}: ${formatCompactNumber(usage.walletRequestCount)} · ${t('Subscription')}: ${formatCompactNumber(usage.subscriptionRequestCount)}`,
      icon: Activity,
      tone: 'chart-4',
    },
  ]

  return (
    <div className='bg-border/60 grid grid-cols-2 gap-px overflow-hidden rounded-lg border lg:grid-cols-5'>
      {stats.map((item) => (
        <div
          key={item.label}
          className='bg-card min-w-0 px-2.5 py-2.5 sm:px-5 sm:py-4'
        >
          <div className='flex items-center gap-1.5 sm:gap-2.5'>
            <IconBadge tone={item.tone} size='stat'>
              <item.icon />
            </IconBadge>
            <div className='text-muted-foreground truncate text-[11px] font-medium tracking-wider uppercase sm:text-xs'>
              {item.label}
            </div>
          </div>

          <div className='text-foreground mt-1.5 font-mono text-sm font-bold tracking-tight break-all tabular-nums sm:mt-2.5 sm:text-2xl'>
            {item.value}
          </div>
          <div className='text-muted-foreground/60 mt-1 hidden text-xs md:block'>
            {item.description}
          </div>
        </div>
      ))}
    </div>
  )
}
