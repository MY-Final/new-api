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
import { Ticket, TrendingUp, Wallet, Layers, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  StatCard,
  type StatCardDetail,
} from '@/features/dashboard/components/ui/stat-card'
import { formatQuota } from '@/lib/format'

import type { RedemptionSummary } from '../types'

interface RedemptionSummaryCard {
  key: string
  title: string
  value: string | number
  description: string
  icon: LucideIcon
  tone: 'accent-1' | 'accent-2' | 'accent-3'
  details?: StatCardDetail[]
}

export function RedemptionsSummaryCards(props: {
  summary?: RedemptionSummary
  loading: boolean
  error: boolean
}) {
  const { t } = useTranslation()

  const format = (value?: number) => formatQuota(value ?? 0)
  const total = props.summary?.total ?? 0
  const used = props.summary?.used ?? 0
  const redeemedRate = total > 0 ? Math.round((used / total) * 100) : 0

  const cards: RedemptionSummaryCard[] = [
    {
      key: 'total',
      title: t('Redemption Codes'),
      value: total,
      description: t('Issued under the current filter'),
      icon: Ticket,
      tone: 'accent-1' as const,
      details: [
        { label: t('Used'), value: String(used) },
        {
          label: t('Unused'),
          value: String(props.summary?.available ?? 0),
          tone: 'success',
        },
        {
          label: t('Expired'),
          value: String(props.summary?.expired ?? 0),
          tone: 'warning',
        },
        {
          label: t('Disabled'),
          value: String(props.summary?.disabled ?? 0),
          tone: 'muted',
        },
      ],
    },
    {
      key: 'redeemed',
      title: t('Redeemed quota'),
      value: format(props.summary?.redeemed_quota),
      description: t('Quota already redeemed by users'),
      icon: Wallet,
      tone: 'accent-3' as const,
      details: [
        {
          label: t('Paid quota'),
          value: format(props.summary?.redeemed_paid_quota),
        },
        {
          label: t('Bonus quota'),
          value: format(props.summary?.redeemed_bonus_quota),
          tone: 'success',
        },
      ],
    },
    {
      key: 'available',
      title: t('Remaining usable quota'),
      value: format(props.summary?.available_quota),
      description: t('Quota in unused codes that can still be redeemed'),
      icon: Layers,
      tone: 'accent-2' as const,
      details: [
        {
          label: t('Paid quota'),
          value: format(props.summary?.available_paid_quota),
        },
        {
          label: t('Bonus quota'),
          value: format(props.summary?.available_bonus_quota),
          tone: 'success',
        },
      ],
    },
    {
      key: 'rate',
      title: t('Redeemed rate'),
      value: `${redeemedRate}%`,
      description: t('{{used}} of {{total}} codes redeemed', { used, total }),
      icon: TrendingUp,
      tone: 'accent-1' as const,
      details: [
        {
          label: t('Issued quota'),
          value: format(props.summary?.issued_quota),
        },
        {
          label: t('Refunded quota'),
          value: format(props.summary?.refunded_quota),
          tone: 'muted',
        },
        {
          label: t('Expired quota'),
          value: format(props.summary?.expired_quota),
          tone: 'warning',
        },
        {
          label: t('Disabled quota'),
          value: format(props.summary?.disabled_quota),
          tone: 'muted',
        },
      ],
    },
  ]

  return (
    <div className='grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-4'>
      {cards.map((card) => (
        <div
          key={card.key}
          className='bg-card rounded-xl border p-3.5 shadow-xs sm:p-4'
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
