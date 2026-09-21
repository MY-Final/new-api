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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface StyleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDescription: string
  onUseStyle: (description: string) => void
}

export function StyleDialog(props: StyleDialogProps) {
  const { t } = useTranslation()
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (props.open) setDescription(props.initialDescription)
  }, [props.initialDescription, props.open])

  const trimmed = description.trim()

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Custom animation style')}
      description={t(
        'Describe the pelican you want. Leave it empty to rotate the built-in styles: Iron Man, Spider-Man, Batman, Astronaut.'
      )}
      contentClassName='sm:max-w-[560px]'
      contentHeight='auto'
      bodyClassName='space-y-3'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            onClick={() => {
              props.onUseStyle(trimmed)
              props.onOpenChange(false)
            }}
          >
            {trimmed ? t('Use this style') : t('Use preset styles')}
          </Button>
        </>
      }
    >
      <Label htmlFor='intelligence-style-description'>
        {t('Style description')}
      </Label>
      <Textarea
        id='intelligence-style-description'
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={4}
        placeholder={t('e.g. A cyberpunk pelican with neon wings')}
      />
    </Dialog>
  )
}
