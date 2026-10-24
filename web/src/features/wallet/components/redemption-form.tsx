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
import { ExternalLink, Gift, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface RedemptionFormProps {
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  topupLink?: string
}

/** Code entry shared by the recharge card and the dedicated redemption card. */
export function RedemptionForm(props: RedemptionFormProps) {
  const { t } = useTranslation()

  return (
    <div className='space-y-2.5 sm:space-y-3'>
      <div className='flex items-center gap-2'>
        <IconBadge tone='warning' size='xs'>
          <Gift />
        </IconBadge>
        <Label
          htmlFor='redemption-code'
          className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
        >
          {t('Have a Code?')}
        </Label>
      </div>
      <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
        <Input
          id='redemption-code'
          value={props.redemptionCode}
          onChange={(event) => props.onRedemptionCodeChange(event.target.value)}
          placeholder={t('Enter your redemption code')}
          className='h-9 min-w-0'
        />
        <Button
          onClick={props.onRedeem}
          disabled={props.redeeming}
          variant='outline'
          className='h-9 px-4'
        >
          {props.redeeming && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          {t('Redeem')}
        </Button>
      </div>
      {props.topupLink && (
        <p className='text-muted-foreground text-xs'>
          {t('Need a redemption code?')}{' '}
          <a
            href={props.topupLink}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-1 underline-offset-4 hover:underline'
          >
            {t('Get one here')}
            <ExternalLink className='h-3 w-3' />
          </a>
        </p>
      )}
    </div>
  )
}
