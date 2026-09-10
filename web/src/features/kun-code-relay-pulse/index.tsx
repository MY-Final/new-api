/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'

export function KunCodeRelayPulse() {
  const { t } = useTranslation()
  const { status, loading } = useStatus()
  const relayPulseUrl =
    typeof status?.kuncode_relay_pulse_url === 'string'
      ? status.kuncode_relay_pulse_url.trim()
      : ''

  if (!relayPulseUrl) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center p-8'>
        {!loading && (
          <div className='max-w-md space-y-2 text-center'>
            <h2 className='text-lg font-semibold'>
              {t('KunCodeRelayPulse is not configured')}
            </h2>
            <p className='text-muted-foreground text-sm'>
              {t(
                'The administrator has not configured the KunCodeRelayPulse URL yet.'
              )}
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    /* eslint-disable react/iframe-missing-sandbox -- third-party monitoring page needs its own origin (cookies/sessionStorage) */
    <iframe
      src={relayPulseUrl}
      title={t('KunCodeRelayPulse')}
      sandbox='allow-scripts allow-same-origin allow-forms allow-popups'
      className='min-h-0 w-full flex-1 border-0'
    />
    /* eslint-enable react/iframe-missing-sandbox */
  )
}
