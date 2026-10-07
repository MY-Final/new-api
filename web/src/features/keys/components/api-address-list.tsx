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

import { CopyButton } from '@/components/copy-button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item'

import { useApiAddresses } from '../hooks/use-api-addresses'

/**
 * Shared list of API addresses with per-address copy buttons. Reused by the
 * page-level address popover and the post-create next-step dialog so both stay
 * in sync with the configured addresses.
 */
export function ApiAddressList() {
  const { t } = useTranslation()
  const { addresses } = useApiAddresses()

  return (
    <ItemGroup>
      {addresses.map((address) => (
        <Item
          key={address.url}
          role='listitem'
          variant='muted'
          size='xs'
          className='flex-nowrap items-start'
        >
          <ItemContent className='min-w-0 gap-1'>
            {address.route && (
              <ItemTitle className='line-clamp-none break-all'>
                {address.route}
              </ItemTitle>
            )}
            <code className='text-xs break-all select-text'>{address.url}</code>
            {address.description && (
              <ItemDescription className='line-clamp-none break-words'>
                {address.description}
              </ItemDescription>
            )}
          </ItemContent>
          <ItemActions>
            <CopyButton
              value={address.url}
              size='sm'
              tooltip={t('Copy API URL')}
              aria-label={`${t('Copy API URL')}: ${address.url}`}
            />
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}
