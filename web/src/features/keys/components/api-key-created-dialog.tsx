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
import { CircleCheckBig, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item'

import { ApiAddressList } from './api-address-list'
import { useApiKeys } from './api-keys-provider'

interface ApiKeyCreatedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Post-create next-step guidance. The create endpoint returns the raw key
 * exactly once, so the dialog shows it with a copy action and lists the
 * configured API addresses.
 */
export function ApiKeyCreatedDialog(props: ApiKeyCreatedDialogProps) {
  const { t } = useTranslation()
  const { createdKeys } = useApiKeys()

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <span className='flex items-center gap-2'>
          <CircleCheckBig className='text-success size-4' aria-hidden='true' />
          {t('API Key created')}
        </span>
      }
      description={t(
        'Copy your API key now. For security, it will not be shown again in full.'
      )}
      contentClassName='sm:max-w-lg'
      bodyClassName='space-y-4'
      footer={
        <Button onClick={() => props.onOpenChange(false)}>{t('Done')}</Button>
      }
    >
      <div className='space-y-4'>
        {createdKeys.length > 0 && (
          <div className='space-y-2'>
            <p className='text-sm font-medium'>{t('API Key')}</p>
            <ItemGroup>
              {createdKeys.map((created) => (
                <Item
                  key={created.key}
                  role='listitem'
                  variant='muted'
                  size='xs'
                  className='flex-nowrap items-start'
                >
                  <ItemContent className='min-w-0 gap-1'>
                    {created.name && (
                      <ItemTitle className='line-clamp-none break-all'>
                        {created.name}
                      </ItemTitle>
                    )}
                    <code className='text-xs break-all select-text'>
                      {created.key}
                    </code>
                  </ItemContent>
                  <ItemActions>
                    <CopyButton
                      value={created.key}
                      size='sm'
                      tooltip={t('Copy API key')}
                      aria-label={`${t('Copy API key')}: ${created.name || created.key}`}
                    />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </div>
        )}

        <div className='border-border/70 bg-muted/30 flex items-start gap-2 rounded-lg border p-3 text-sm'>
          <KeyRound
            className='text-muted-foreground mt-0.5 size-4 shrink-0'
            aria-hidden='true'
          />
          <p className='text-muted-foreground'>
            {t('Keep this key secret. Anyone with it can use your account.')}
          </p>
        </div>

        <div className='space-y-2'>
          <p className='text-sm font-medium'>{t('API Addresses')}</p>
          <ApiAddressList />
        </div>
      </div>
    </Dialog>
  )
}
