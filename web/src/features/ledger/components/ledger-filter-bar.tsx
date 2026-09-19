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
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { cn } from '@/lib/utils'

export function LedgerFilterBar(props: {
  start?: Date
  end?: Date
  username: string
  onRangeChange: (range: { start?: Date; end?: Date }) => void
  onUsernameChange: (value: string) => void
  onClear: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const hasActiveFilters = Boolean(props.start || props.end || props.username)

  return (
    <div className={cn('flex flex-wrap items-center gap-2', props.className)}>
      <Input
        className='w-full sm:w-56'
        value={props.username}
        aria-label={t('Search username')}
        placeholder={t('Search username')}
        onChange={(event) => props.onUsernameChange(event.target.value)}
      />
      <CompactDateTimeRangePicker
        start={props.start}
        end={props.end}
        className='w-full sm:w-72'
        onChange={props.onRangeChange}
      />
      {hasActiveFilters ? (
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground'
          onClick={props.onClear}
        >
          <X aria-hidden='true' />
          {t('Clear filters')}
        </Button>
      ) : null}
    </div>
  )
}
