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
  AlertTriangle,
  CalendarCheck,
  Coins,
  Flame,
  Gift,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  StatCard,
  type StatCardDetail,
} from '@/features/dashboard/components/ui/stat-card'
import { formatQuota } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { QuotaLedgerSummary } from '../types'

interface LedgerSummaryCard {
  key: string
  title: string
  value: string | number
  description: string
  icon: LucideIcon
  tone: 'accent-1' | 'accent-2' | 'accent-3'
  details?: StatCardDetail[]
}

export function LedgerSummaryCards(props: {
  summary?: QuotaLedgerSummary
  loading: boolean
  error: boolean
}) {
  const { t } = useTranslation()
  useSystemConfigStore((state) => state.config.currency)

  const format = (value?: number) => formatQuota(value ?? 0)
  const cards: LedgerSummaryCard[] = [
    {
      key: 'consumed',
      title: t('Total consumed'),
      value: format(props.summary?.total_consumed_quota),
      description: t('All-time consumption of this site'),
      icon: Flame,
      tone: 'accent-1' as const,
    },
    {
      key: 'range',
      title: t('Consumption in selected period'),
      value: format(props.summary?.range_quota),
      description: t('Paid quota + welfare quota'),
      icon: TrendingUp,
      tone: 'accent-2' as const,
      details: [
        {
          label: t('Paid quota'),
          value: format(props.summary?.range_paid_quota),
        },
        {
          label: t('Welfare quota'),
          value: format(props.summary?.range_bonus_quota),
        },
      ],
    },
    {
      key: 'remaining',
      title: t('Remaining quota'),
      value: format(props.summary?.remaining_quota),
      description: t('Available quota of all users'),
      icon: Wallet,
      tone: 'accent-3' as const,
      details: [
        {
          label: t('Paid quota'),
          value: format(props.summary?.remaining_paid_quota),
        },
        {
          label: t('Welfare quota'),
          value: format(props.summary?.remaining_bonus_quota),
        },
      ],
    },
    {
      key: 'remaining-bonus',
      title: t('Remaining welfare quota'),
      value: format(props.summary?.remaining_bonus_quota),
      description: t('Grants such as check-in rewards'),
      icon: Gift,
      tone: 'accent-2' as const,
    },
    {
      key: 'remaining-paid',
      title: t('Remaining paid quota'),
      value: format(props.summary?.remaining_paid_quota),
      description: t('Top-ups and admin grants'),
      icon: Coins,
      tone: 'accent-1' as const,
    },
    {
      key: 'debt',
      title: t('Debt users'),
      value: props.summary?.debt_users ?? 0,
      description: t('Outstanding debt: {{quota}}', {
        quota: format(-(props.summary?.debt_quota ?? 0)),
      }),
      icon: AlertTriangle,
      tone: 'accent-3' as const,
    },
    {
      key: 'checkin',
      title: t('Check-in welfare issued today'),
      value: format(props.summary?.today_checkin_bonus),
      description: t('{{count}} user(s) checked in today', {
        count: props.summary?.today_checkin_users ?? 0,
      }),
      icon: CalendarCheck,
      tone: 'accent-2' as const,
    },
  ]

  return (
    <div className='grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4'>
      {cards.map((card) => (
        <div
          key={card.key}
          className='bg-card rounded-xl border p-3 shadow-xs sm:p-4'
        >
          <StatCard
            title={card.title}
            value={card.value}
            description={card.description}
            icon={card.icon}
            tone={card.tone}
            details={card.details}
            loading={props.loading}
            error={props.error}
            compactMobile
          />
        </div>
      ))}
    </div>
  )
}
