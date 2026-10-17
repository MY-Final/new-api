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
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'

import { AnnouncementImages } from '@/components/announcement-images'
import { Input } from '@/components/ui/input'
import { useStatus } from '@/hooks/use-status'

export function AnnouncementImagesField(
  props: {
    value: number[]
    onChange: (images: number[]) => void
    onUpload: (files: File[]) => Promise<void>
  } & Pick<
    ComponentProps<typeof Input>,
    'id' | 'aria-describedby' | 'aria-invalid' | 'disabled'
  >
) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const enabled = status?.console_images_enabled === true

  return (
    <div className='space-y-2'>
      <AnnouncementImages
        images={props.value}
        onRemove={
          props.disabled
            ? undefined
            : (id) =>
                props.onChange(props.value.filter((value) => value !== id))
        }
      />
      {enabled ? (
        <>
          <Input
            id={props.id}
            aria-label={t('Images')}
            aria-describedby={props['aria-describedby']}
            aria-invalid={props['aria-invalid']}
            type='file'
            accept='image/png,image/jpeg'
            multiple
            disabled={props.disabled}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])]
              event.target.value = ''
              void props.onUpload(files)
            }}
          />
          <p className='text-muted-foreground text-xs'>
            {t('Up to 9 PNG or JPEG images, 5 MB each')}
          </p>
        </>
      ) : (
        <p className='text-muted-foreground text-xs'>
          {t('Image upload is unavailable until R2 storage is configured')}
        </p>
      )}
    </div>
  )
}
