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

import { StatusBadge } from '@/components/status-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import {
  formatCompactNumber,
  formatPercent,
  formatQuota,
  formatQuotaPrecise,
  resolveUserUsageBreakdown,
} from '@/lib/format'
import { getRoleLabel } from '@/lib/roles'

import { getDisplayName } from '../lib'
import type { UserProfile } from '../types'

// ============================================================================
// Profile Header Component
// ============================================================================

interface ProfileHeaderProps {
  profile: UserProfile | null
  loading: boolean
}

export function ProfileHeader({ profile, loading }: ProfileHeaderProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardContent className='p-4 sm:p-5'>
          <div className='flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left'>
            <Skeleton className='h-16 w-16 rounded-2xl' />
            <div className='space-y-3'>
              <div className='flex flex-col items-center gap-2 sm:flex-row sm:justify-start'>
                <Skeleton className='h-8 w-48' />
                <Skeleton className='h-5 w-16' />
              </div>
              <div className='flex flex-col items-center gap-1 sm:flex-row sm:justify-start sm:gap-4'>
                <Skeleton className='h-4 w-24' />
                <Skeleton className='h-4 w-40' />
                <Skeleton className='h-4 w-20' />
              </div>
            </div>
          </div>
        </CardContent>
        <div className='bg-border/60 grid grid-cols-2 gap-px border-t lg:grid-cols-5'>
          {['balance', 'total', 'wallet', 'subscription', 'requests'].map(
            (key) => (
              <div key={key} className='bg-card px-4 py-3.5 sm:px-5 sm:py-4'>
                <Skeleton className='h-3.5 w-20' />
                <Skeleton className='mt-2 h-7 w-28' />
                <Skeleton className='mt-1.5 h-3.5 w-24' />
              </div>
            )
          )}
        </div>
      </Card>
    )
  }

  if (!profile) return null

  const displayName = getDisplayName(profile)
  const avatarName = profile.username || displayName
  const avatarFallback = getUserAvatarFallback(avatarName)
  const avatarFallbackStyle = getUserAvatarStyle(avatarName)
  const roleLabel = getRoleLabel(profile.role)
  const hasDebt = profile.quota < 0
  const displayedQuota = Math.abs(profile.quota)
  const bonusQuota = Math.max(profile.bonus_quota ?? 0, 0)
  const paidQuota = profile.paid_quota ?? 0
  const usage = resolveUserUsageBreakdown(profile)
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
      value: formatCompactNumber(profile.request_count),
      description: `${t('Wallet')}: ${formatCompactNumber(usage.walletRequestCount)} · ${t('Subscription')}: ${formatCompactNumber(usage.subscriptionRequestCount)}`,
      icon: Activity,
      tone: 'chart-4',
    },
  ]

  return (
    <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
      <CardContent className='p-3 sm:p-5'>
        <div className='flex items-center gap-3 text-left sm:gap-4'>
          <Avatar className='ring-background h-12 w-12 rounded-xl text-sm ring-2 sm:h-16 sm:w-16 sm:rounded-2xl sm:text-lg sm:ring-4'>
            <AvatarFallback
              className='rounded-xl font-semibold text-white sm:rounded-2xl'
              style={avatarFallbackStyle}
            >
              {avatarFallback}
            </AvatarFallback>
          </Avatar>

          <div className='min-w-0 flex-1 space-y-1.5 sm:space-y-3'>
            <div className='flex min-w-0 items-center gap-2'>
              <h1 className='truncate text-xl font-semibold tracking-tight sm:text-2xl'>
                {displayName}
              </h1>
              <StatusBadge
                label={roleLabel}
                variant='neutral'
                copyable={false}
              />
              <StatusBadge
                label={`${t('User ID')} ${profile.id}`}
                variant='info'
                copyText={String(profile.id)}
              />
            </div>

            <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:gap-x-4 sm:text-sm'>
              <span className='truncate'>@{profile.username}</span>
              {profile.email && (
                <>
                  <span>•</span>
                  <span className='truncate'>{profile.email}</span>
                </>
              )}
              {profile.group && (
                <>
                  <span>•</span>
                  <span className='truncate'>{profile.group}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
      <div className='bg-border/60 grid grid-cols-2 gap-px border-t lg:grid-cols-5'>
        {stats.map((item) => (
          <div
            key={item.label}
            className='bg-card min-w-0 px-3 py-3 sm:px-5 sm:py-4'
          >
            <div className='flex items-center gap-2'>
              <IconBadge tone={item.tone} size='stat'>
                <item.icon />
              </IconBadge>
              <div className='text-muted-foreground truncate text-xs font-medium tracking-wider uppercase'>
                {item.label}
              </div>
            </div>

            <div className='text-foreground mt-1.5 truncate font-mono text-lg font-bold tracking-tight tabular-nums sm:mt-2 sm:text-2xl'>
              {item.value}
            </div>
            <div className='text-muted-foreground/60 mt-1 hidden text-xs md:block'>
              {item.description}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
