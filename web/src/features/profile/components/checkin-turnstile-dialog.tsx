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
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Turnstile } from '@/components/turnstile'

import type { CheckinTurnstileState } from '../hooks/use-checkin'

type CheckinTurnstileDialogProps = {
  siteKey: string
  state: CheckinTurnstileState
}

/**
 * Cloudflare Turnstile prompt shared by the check-in entry points. It opens
 * only when the server rejects a check-in for a missing or invalid token.
 */
export function CheckinTurnstileDialog(props: CheckinTurnstileDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={props.state.visible}
      onOpenChange={props.state.setVisible}
      title={t('Security Check')}
      contentClassName='sm:max-w-md'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <div className='text-muted-foreground text-sm'>
        {t('Please complete the security check to continue.')}
      </div>
      <div className='flex justify-center py-4'>
        <Turnstile
          key={props.state.widgetKey}
          siteKey={props.siteKey}
          onVerify={props.state.verify}
          onExpire={props.state.retry}
        />
      </div>
    </Dialog>
  )
}
