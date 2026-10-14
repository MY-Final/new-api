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
import { Link, useLocation } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FloatingWindow } from '@/components/floating-window'
import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'

import { useCheckin } from '../hooks/use-checkin'
import { CheckinTurnstileDialog } from './checkin-turnstile-dialog'

const WINDOW_WIDTH = 320
/** The window is content-sized, so this keeps its top clear of the bottom edge. */
const WINDOW_BOTTOM_OFFSET = 360
const DISMISSED_STORAGE_KEY = 'checkin-floating-window:dismissed'

/**
 * Global check-in entry point. It floats above every authenticated page while
 * today's check-in is still available, then disappears once the reward is
 * claimed or the user closes it for the day. The profile page keeps the full
 * calendar card, so the window stays out of the way there.
 */
export function CheckinFloatingWindow() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const pathname = useLocation({ select: (location) => location.pathname })
  const [dismissedDay, setDismissedDay] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(DISMISSED_STORAGE_KEY)
    } catch {
      return null
    }
  })
  const [defaultPosition] = useState(() => ({
    x: Math.max(16, window.innerWidth - WINDOW_WIDTH - 24),
    y: Math.max(16, window.innerHeight - WINDOW_BOTTOM_OFFSET),
  }))

  const checkinEnabled = status?.checkin_enabled === true
  const turnstileEnabled = !!(
    status?.turnstile_check && status?.turnstile_site_key
  )
  const turnstileSiteKey = status?.turnstile_site_key || ''
  const today = dayjs().format('YYYY-MM-DD')
  const onProfilePage =
    pathname === '/profile' || pathname.startsWith('/profile/')

  const {
    data,
    isLoading,
    checkedToday,
    checkinLoading,
    startCheckin,
    turnstile,
  } = useCheckin({
    enabled: checkinEnabled,
    turnstileEnabled,
    turnstileSiteKey,
    month: dayjs().format('YYYY-MM'),
  })

  if (
    !checkinEnabled ||
    isLoading ||
    !data ||
    checkedToday ||
    dismissedDay === today ||
    onProfilePage
  ) {
    return null
  }

  const dismissForToday = () => {
    try {
      window.localStorage.setItem(DISMISSED_STORAGE_KEY, today)
    } catch {
      // Storage may be unavailable; the window still closes for this session.
    }
    setDismissedDay(today)
  }

  const minQuota = data.min_quota
  const maxQuota = data.max_quota
  let rewardRange = '-'
  if (typeof minQuota === 'number' && typeof maxQuota === 'number') {
    rewardRange =
      minQuota === maxQuota
        ? formatQuotaWithCurrency(minQuota)
        : `${formatQuotaWithCurrency(minQuota)} - ${formatQuotaWithCurrency(maxQuota)}`
  }

  return (
    <>
      <CheckinTurnstileDialog siteKey={turnstileSiteKey} state={turnstile} />
      <FloatingWindow
        title={t('Daily Check-in')}
        defaultPosition={defaultPosition}
        defaultWidth={WINDOW_WIDTH}
        minWidth={280}
        storageKey='checkin'
        onClose={dismissForToday}
      >
        <div className='space-y-3'>
          <p className='text-muted-foreground text-sm'>
            {t('Check in daily to receive random quota rewards')}
          </p>

          <div className='bg-muted/30 space-y-1.5 rounded-lg border p-3 text-sm'>
            <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
              <span className='text-muted-foreground'>{t('Reward range')}</span>
              <span className='font-medium tabular-nums'>{rewardRange}</span>
            </div>
            <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
              <span className='text-muted-foreground'>
                {t('Total check-ins')}
              </span>
              <span className='font-medium tabular-nums'>
                {data.stats.total_checkins}
              </span>
            </div>
          </div>

          <Button
            type='button'
            className='w-full'
            onClick={startCheckin}
            disabled={checkinLoading}
          >
            {checkinLoading ? t('Loading...') : t('Check in now')}
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='w-full'
            render={<Link to='/profile' />}
          >
            {t('View calendar')}
          </Button>
        </div>
      </FloatingWindow>
    </>
  )
}
