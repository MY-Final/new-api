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

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useStatus } from '@/hooks/use-status'

export function ScreenshotsInput(props: {
  id: string
  disabled: boolean
  onChange: (files: File[]) => void
}) {
  const { t } = useTranslation()
  const { status } = useStatus()
  if (status?.ticket_images_enabled !== true) {
    return (
      <p className='text-muted-foreground text-xs'>
        {t('Ticket image uploads are disabled')}
      </p>
    )
  }
  return (
    <div className='space-y-2'>
      <Label htmlFor={props.id}>{t('Screenshots')}</Label>
      <Input
        id={props.id}
        type='file'
        accept='image/png,image/jpeg'
        multiple
        disabled={props.disabled}
        onChange={(event) => props.onChange([...(event.target.files ?? [])])}
      />
      <p className='text-muted-foreground text-xs'>
        {t('Choose up to 3 PNG or JPEG screenshots, 5 MB each')}
      </p>
      <p className='text-muted-foreground text-xs'>
        {t('Images expire after {{days}} days. Ticket messages are kept.', {
          days: status.ticket_image_retention_days ?? 30,
        })}
      </p>
    </div>
  )
}
