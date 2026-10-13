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

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export function TicketSelect(props: {
  label: string
  value: string
  options: Record<string, string>
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value !== null) props.onChange(value)
      }}
      disabled={props.disabled}
    >
      <SelectTrigger
        aria-label={props.label}
        className={cn('w-full', props.className)}
      >
        <SelectValue>
          {t(props.options[props.value] ?? props.value)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {Object.entries(props.options).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {t(label)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
