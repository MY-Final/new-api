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
import { X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AnnouncementImagesProps = {
  images?: number[]
  onRemove?: (id: number) => void
  className?: string
}

export function AnnouncementImages(props: AnnouncementImagesProps) {
  const { t } = useTranslation()
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [failedIds, setFailedIds] = useState<number[]>([])
  const images = (props.images ?? []).filter((id) => !failedIds.includes(id))
  if (images.length === 0) return null
  const previewIndex = previewId === null ? -1 : images.indexOf(previewId)
  return (
    <>
      <div className={cn('grid grid-cols-3 gap-2', props.className)}>
        {images.map((id) => (
          <div
            key={id}
            className='group relative overflow-hidden rounded-lg border'
          >
            <Button
              variant='ghost'
              type='button'
              onClick={() => setPreviewId(id)}
              aria-label={t('Announcement image')}
              className='block h-auto w-full cursor-zoom-in rounded-none p-0'
            >
              <img
                src={`/api/console-images/${id}`}
                alt={t('Announcement image')}
                loading='lazy'
                className='aspect-video w-full object-cover'
                onError={() =>
                  setFailedIds((previous) =>
                    previous.includes(id) ? previous : [...previous, id]
                  )
                }
              />
            </Button>
            {props.onRemove && (
              <Button
                type='button'
                variant='secondary'
                size='icon-xs'
                aria-label={t('Remove image')}
                className='absolute top-1 right-1 opacity-90'
                onClick={() => {
                  if (previewId === id) setPreviewId(null)
                  props.onRemove?.(id)
                }}
              >
                <X />
              </Button>
            )}
          </div>
        ))}
      </div>
      <ImagePreviewDialog
        src={previewId === null ? null : `/api/console-images/${previewId}`}
        alt={t('Announcement image')}
        onClose={() => setPreviewId(null)}
        onPrevious={
          previewIndex > 0
            ? () => setPreviewId(images[previewIndex - 1])
            : undefined
        }
        onNext={
          previewIndex >= 0 && previewIndex < images.length - 1
            ? () => setPreviewId(images[previewIndex + 1])
            : undefined
        }
      />
    </>
  )
}
