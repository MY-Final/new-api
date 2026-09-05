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
import { MessageCircle, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import qqGroupImage from '@/assets/contact/qq-group.jpg'
import { Button } from '@/components/ui/button'

export const QQ_GROUP_NUMBER = '1072957415'
export const QQ_GROUP_JOIN_URL =
  'https://qun.qq.com/universal-share/share?ac=1&svctype=5&tempid=h5_group_info&busi_data=eyJncm91cENvZGUiOiIxMDcyOTU3NDE1In0%3D'

export function ContactDetails() {
  const { t } = useTranslation()

  return (
    <div className='space-y-5'>
      <div className='border-border bg-muted/20 flex justify-center rounded-xl border p-3 sm:p-5'>
        <img
          src={qqGroupImage}
          alt={t('QQ group QR code')}
          className='h-auto max-h-[min(60vh,34rem)] w-auto max-w-full rounded-lg object-contain'
        />
      </div>

      <div className='border-border flex flex-col items-center gap-2 rounded-xl border p-4 text-center'>
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <Users className='size-4' aria-hidden='true' />
          {t('QQ Group Number')}
        </div>
        <div className='font-mono text-xl font-semibold tracking-widest sm:text-2xl'>
          {QQ_GROUP_NUMBER}
        </div>
        <p className='text-muted-foreground text-xs'>
          {t('Scan the QR code to join, or use the link below.')}
        </p>
        <Button
          render={
            <a
              href={QQ_GROUP_JOIN_URL}
              target='_blank'
              rel='noopener noreferrer'
            />
          }
          className='mt-2'
        >
          <MessageCircle className='size-4' aria-hidden='true' />
          {t('Join QQ Group')}
        </Button>
      </div>
    </div>
  )
}
