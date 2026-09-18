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
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AUTO_REFRESH_INTERVALS } from '@/hooks'
import { cn } from '@/lib/utils'

interface AutoRefreshControlProps {
  autoRefreshInterval: number
  onAutoRefreshIntervalChange: (interval: number) => void
}

/**
 * Toolbar control that toggles automatic log refresh and selects its cadence.
 * Off by default; the current cadence is shown on the trigger while active.
 */
export function AutoRefreshControl(props: AutoRefreshControlProps) {
  const { t } = useTranslation()
  const activeOption = AUTO_REFRESH_INTERVALS.find(
    (option) => option.value === props.autoRefreshInterval
  )
  const isActive = props.autoRefreshInterval > 0 && activeOption != null

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            type='button'
            variant='outline'
            className={cn(
              'shrink-0',
              isActive && 'border-primary/50 text-primary'
            )}
          />
        }
      >
        <RefreshCw aria-hidden='true' />
        {t('Auto refresh')}
        {isActive && (
          <>
            {' · '}
            {t(activeOption.labelKey)}
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('Auto refresh')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(props.autoRefreshInterval)}
            onValueChange={(value) =>
              props.onAutoRefreshIntervalChange(Number(value))
            }
          >
            {AUTO_REFRESH_INTERVALS.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={String(option.value)}
              >
                {t(option.labelKey)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
