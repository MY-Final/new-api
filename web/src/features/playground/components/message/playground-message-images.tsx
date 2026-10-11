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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { cn } from '@/lib/utils'

type PlaygroundMessageImagesProps = {
  images: string[]
  className?: string
}

/**
 * Attached images of a user message: thumbnails that open in a preview dialog
 * with arrow-key navigation between the message's images.
 */
export function PlaygroundMessageImages({
  images,
  className,
}: PlaygroundMessageImagesProps) {
  const { t } = useTranslation()
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  // Identical images can be attached twice, so key each occurrence.
  const keyedImages = useMemo(() => {
    const seen = new Map<string, number>()
    return images.map((src) => {
      const occurrence = seen.get(src) ?? 0
      seen.set(src, occurrence + 1)
      return { key: `${occurrence}-${src.slice(-40)}`, src }
    })
  }, [images])

  if (images.length === 0) {
    return null
  }

  const hasMultiple = images.length > 1
  const previewSrc = previewIndex === null ? null : (images[previewIndex] ?? null)

  return (
    <>
      <div className={cn('flex flex-wrap gap-2', className)}>
        {keyedImages.map(({ key, src }, index) => (
          <button
            key={key}
            type='button'
            aria-label={t('Preview image')}
            className='border-border/60 bg-muted/30 focus-visible:ring-ring/50 size-24 overflow-hidden rounded-lg border transition-opacity hover:opacity-90 focus-visible:ring-[3px] focus-visible:outline-none'
            onClick={() => setPreviewIndex(index)}
          >
            <img
              alt={t('Attached image')}
              className='size-full object-cover'
              src={src}
            />
          </button>
        ))}
      </div>

      <ImagePreviewDialog
        alt={t('Attached image')}
        onClose={() => setPreviewIndex(null)}
        onNext={
          hasMultiple
            ? () =>
                setPreviewIndex((current) =>
                  current === null ? null : (current + 1) % images.length
                )
            : undefined
        }
        onPrevious={
          hasMultiple
            ? () =>
                setPreviewIndex((current) =>
                  current === null
                    ? null
                    : (current - 1 + images.length) % images.length
                )
            : undefined
        }
        src={previewSrc}
      />
    </>
  )
}
