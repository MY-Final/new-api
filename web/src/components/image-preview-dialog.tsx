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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

type ImagePreviewDialogProps = {
  src: string | null
  alt?: string
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
}

export function ImagePreviewDialog({
  src,
  alt,
  onClose,
  onPrevious,
  onNext,
}: ImagePreviewDialogProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (src === null || (!onPrevious && !onNext)) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && onPrevious) {
        event.preventDefault()
        onPrevious()
      } else if (event.key === 'ArrowRight' && onNext) {
        event.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNext, onPrevious, src])

  return (
    <Dialog open={src !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton
        className='flex h-[85vh] min-h-0 w-[92vw] max-w-none min-w-0 items-center justify-center overflow-hidden p-2 sm:max-w-none'
      >
        <DialogTitle className='sr-only'>{alt ?? t('Preview')}</DialogTitle>
        {onPrevious && (
          <Button
            type='button'
            variant='secondary'
            size='icon'
            aria-label={t('Previous')}
            onClick={onPrevious}
            className='absolute top-1/2 left-3 -translate-y-1/2'
          >
            <ChevronLeft className='h-5 w-5' />
          </Button>
        )}
        {src && (
          <img
            src={src}
            alt={alt ?? t('Generated image')}
            className='block max-h-full max-w-full object-contain'
          />
        )}
        {onNext && (
          <Button
            type='button'
            variant='secondary'
            size='icon'
            aria-label={t('Next')}
            onClick={onNext}
            className='absolute top-1/2 right-3 -translate-y-1/2'
          >
            <ChevronRight className='h-5 w-5' />
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
