import { CalendarDays } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Main } from '@/components/layout'
import { CheckinCalendarCard } from '@/features/profile/components/checkin-calendar-card'
import { useStatus } from '@/hooks/use-status'

export function EntertainmentCheckin() {
  const { t } = useTranslation()
  const { status } = useStatus()

  if (!status) return <Main />

  return (
    <Main>
      <div className='mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10'>
        {status?.checkin_enabled ? (
          <CheckinCalendarCard
            checkinEnabled
            turnstileEnabled={
              !!(status.turnstile_check && status.turnstile_site_key)
            }
            turnstileSiteKey={status.turnstile_site_key || ''}
          />
        ) : (
          <EmptyState
            icon={CalendarDays}
            title={t('Check-in feature is not enabled')}
          />
        )}
      </div>
    </Main>
  )
}
