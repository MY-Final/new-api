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

import { Button } from '@/components/ui/button'
import { getRollingDateRange } from '@/lib/time'

import { detectQuickRangeDays } from '../lib/filters'

interface DateRangePresetsProps {
  range: { start: Date; end: Date }
  onChange: (range: { start: Date; end: Date }) => void
}

export function DateRangePresets(props: DateRangePresetsProps) {
  const { t } = useTranslation()
  const selectedDays = detectQuickRangeDays(props.range.start, props.range.end)

  return (
    <div
      role='group'
      className='flex flex-wrap gap-1'
      aria-label={t('Quick Range')}
    >
      {[
        { days: 0, label: t('Today') },
        { days: 1, label: t('Last 24 hours') },
        { days: 7, label: t('7 Days') },
        { days: 30, label: t('30 Days') },
      ].map((preset) => (
        <Button
          key={preset.days}
          variant={selectedDays === preset.days ? 'secondary' : 'ghost'}
          size='sm'
          aria-pressed={selectedDays === preset.days}
          onClick={() => props.onChange(getRollingDateRange(preset.days))}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  )
}
