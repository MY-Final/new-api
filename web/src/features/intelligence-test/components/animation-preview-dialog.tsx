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
import { Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  WebPreview,
  WebPreviewBody,
} from '@/components/ai-elements/web-preview'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

interface AnimationPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  html: string
}

export function AnimationPreviewDialog(props: AnimationPreviewDialogProps) {
  const { t } = useTranslation()
  const [playbackKey, setPlaybackKey] = useState(0)

  useEffect(() => {
    if (props.open) setPlaybackKey((value) => value + 1)
  }, [props.open])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton
        className='flex h-[85vh] w-[92vw] max-w-none flex-col gap-3 p-3 sm:max-w-none'
      >
        <DialogTitle className='text-base'>
          {t('Animation preview')}
        </DialogTitle>
        <div className='flex min-h-0 flex-1 items-center justify-center'>
          <div className='bg-muted/20 aspect-[3/2] max-h-full w-full max-w-[min(100%,calc(85vh*1.5))] overflow-hidden rounded-lg border'>
            <WebPreview className='rounded-none border-0'>
              <WebPreviewBody
                key={playbackKey}
                srcDoc={props.html}
                sandbox=''
                title={t('Drawing animation preview')}
                className='h-full w-full'
              />
            </WebPreview>
          </div>
        </div>
        <div className='flex justify-end'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => setPlaybackKey((value) => value + 1)}
          >
            <Play />
            {t('Replay')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
