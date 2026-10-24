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
import { Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { TitledCard } from '@/components/ui/titled-card'

import { RedemptionForm } from './redemption-form'

interface RedemptionCardProps {
  enabled: boolean
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  topupLink?: string
}

/**
 * Standalone code redemption card shown next to the shop so users can buy a
 * card and redeem it without leaving the wallet page.
 */
export function RedemptionCard(props: RedemptionCardProps) {
  const { t } = useTranslation()

  return (
    <TitledCard
      title={t('Redemption Code')}
      description={t('Enter a code to add its value to your balance.')}
      icon={<Gift className='h-4 w-4' />}
      iconTone='warning'
      disableHoverEffect
      contentClassName='space-y-2.5 sm:space-y-3'
    >
      {props.enabled ? (
        <RedemptionForm
          redemptionCode={props.redemptionCode}
          onRedemptionCodeChange={props.onRedemptionCodeChange}
          onRedeem={props.onRedeem}
          redeeming={props.redeeming}
          topupLink={props.topupLink}
        />
      ) : (
        <Alert>
          <AlertDescription>
            {t(
              'Redemption codes are disabled until the administrator confirms compliance terms.'
            )}
          </AlertDescription>
        </Alert>
      )}
    </TitledCard>
  )
}
