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
  ArrowRight01Icon,
  Calendar03Icon,
  GiftIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link, useLocation } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FloatingWindow } from '@/components/floating-window'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Spinner } from '@/components/ui/spinner'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { useCheckin } from '../hooks/use-checkin'
import { CheckinTurnstileDialog } from './checkin-turnstile-dialog'

const WINDOW_WIDTH = 336
/** The window is content-sized, so this keeps its top clear of the bottom edge. */
const WINDOW_BOTTOM_OFFSET = 440
const DISMISSED_STORAGE_KEY = 'checkin-floating-window:dismissed'

/**
 * Global check-in entry point. It floats above every authenticated page while
 * today's check-in is still available, then disappears once the reward is
 * claimed or the user closes it for the day. The profile page keeps the full
 * calendar card, so the window stays out of the way there.
 */
export function CheckinFloatingWindow() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfigStore((state) => state.config.currency)
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
        className='border-primary/15 bg-card shadow-primary/10 ring-primary/5 rounded-2xl shadow-2xl ring-1'
      >
        <div className='flex min-w-0 flex-col gap-4'>
          <section
            aria-label={t('Reward range')}
            className='border-warning/20 from-warning/10 via-warning/5 to-background relative isolate min-w-0 overflow-hidden rounded-xl border bg-linear-to-br p-4'
          >
            <div
              aria-hidden='true'
              className='border-warning/10 pointer-events-none absolute -top-8 -right-8 -z-10 size-28 rounded-full border-[12px]'
            />
            <div className='flex min-w-0 items-center gap-3'>
              <IconBadge tone='warning' size='lg'>
                <HugeiconsIcon icon={GiftIcon} strokeWidth={1.7} />
              </IconBadge>
              <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <p className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                  {t('Reward range')}
                  <HugeiconsIcon
                    icon={SparklesIcon}
                    className='text-warning size-3.5 shrink-0'
                    aria-hidden='true'
                  />
                </p>
                <p className='text-foreground text-xl leading-snug font-semibold tracking-tight wrap-anywhere tabular-nums'>
                  {rewardRange}
                </p>
              </div>
            </div>
            <p className='text-muted-foreground mt-3 text-xs leading-relaxed'>
              {t('Check in daily to receive random quota rewards')}
            </p>
          </section>

          <dl className='grid min-w-0 grid-cols-2 gap-3'>
            <div className='flex min-w-0 flex-col gap-1 border-r pr-3'>
              <dt className='text-muted-foreground text-xs'>
                {t('Total check-ins')}
              </dt>
              <dd className='text-sm font-semibold wrap-anywhere tabular-nums'>
                {formatNumber(data.stats.total_checkins, locale)}
              </dd>
            </div>
            <div className='flex min-w-0 flex-col gap-1'>
              <dt className='text-muted-foreground text-xs'>
                {t('Total earned')}
              </dt>
              <dd className='text-sm font-semibold wrap-anywhere tabular-nums'>
                {formatQuotaWithCurrency(data.stats.total_quota)}
              </dd>
            </div>
          </dl>

          <Button
            type='button'
            size='lg'
            className='h-10 w-full rounded-xl'
            onClick={startCheckin}
            disabled={checkinLoading}
            aria-busy={checkinLoading}
          >
            {checkinLoading ? (
              <Spinner
                data-icon='inline-start'
                className='motion-reduce:animate-none'
                aria-hidden='true'
              />
            ) : (
              <HugeiconsIcon
                icon={GiftIcon}
                data-icon='inline-start'
                aria-hidden='true'
              />
            )}
            {checkinLoading ? t('Loading...') : t('Check in now')}
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='-mt-2 w-full min-w-0 gap-2 whitespace-normal'
            render={<Link to='/profile' />}
          >
            <HugeiconsIcon
              icon={Calendar03Icon}
              data-icon='inline-start'
              aria-hidden='true'
            />
            {t('View calendar')}
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              data-icon='inline-end'
              aria-hidden='true'
            />
          </Button>
        </div>
      </FloatingWindow>
    </>
  )
}
