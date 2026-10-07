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
  ArrowRight,
  ExternalLink,
  Gift,
  Sparkles,
  WalletCards,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { cn } from '@/lib/utils'

import type { TopupInfo } from '../types'

interface WalletFundingGuideProps {
  quota?: number | null
  topupInfo: TopupInfo | null
  onStartTopup: () => void
}

export function WalletFundingGuide({
  quota,
  topupInfo,
  onStartTopup,
}: WalletFundingGuideProps) {
  const { t } = useTranslation()
  if (quota == null || !Number.isFinite(quota) || quota > 0) {
    return null
  }

  const hasDebt = quota < 0
  const redemptionEnabled = topupInfo?.enable_redemption !== false
  const hasOnlineTopup =
    topupInfo?.enable_online_topup ||
    topupInfo?.enable_stripe_topup ||
    topupInfo?.enable_waffo_topup ||
    topupInfo?.enable_waffo_pancake_topup ||
    topupInfo?.enable_creem_topup
  const topupLink = topupInfo?.topup_link?.trim()
  let description = t('Contact the administrator to add funds to your account.')
  if (hasOnlineTopup) {
    description = t(
      'Choose an amount and payment method below, then complete payment to add funds.'
    )
  } else if (redemptionEnabled) {
    description = t(
      'Online top-up is unavailable. Use a redemption code or the configured purchase link below.'
    )
  }

  return (
    <Card
      data-card-hover='false'
      className='border-primary/25 bg-primary/5 overflow-hidden'
    >
      <CardContent className='flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5'>
        <div className='flex min-w-0 items-start gap-3'>
          <IconBadge tone='primary' size='lg'>
            <WalletCards />
          </IconBadge>
          <div className='min-w-0 space-y-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <h2 className='text-base font-semibold'>
                {hasDebt
                  ? t('Recharge to settle debt')
                  : t('Need balance to get started?')}
              </h2>
              <span className='bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium'>
                <Sparkles className='size-3' />
                {t('Recommended')}
              </span>
            </div>
            <p className='text-muted-foreground text-sm'>{description}</p>
          </div>
        </div>

        <div className='flex shrink-0 flex-wrap items-center gap-2 sm:justify-end'>
          {hasOnlineTopup && (
            <Button onClick={onStartTopup} className='gap-1.5'>
              {t('Add Funds')}
              <ArrowRight className='size-4' />
            </Button>
          )}
          {!hasOnlineTopup && redemptionEnabled && (
            <Button
              onClick={onStartTopup}
              variant='outline'
              className='gap-1.5'
            >
              <Gift className='size-4' />
              {t('Use a redemption code')}
            </Button>
          )}
          {!hasOnlineTopup && topupLink && (
            <Button
              variant='outline'
              render={
                <a href={topupLink} target='_blank' rel='noopener noreferrer' />
              }
              className={cn('gap-1.5')}
            >
              {t('Get one here')}
              <ExternalLink className='size-4' />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
