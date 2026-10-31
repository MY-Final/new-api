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
import { cn } from '@/lib/utils'

import { detectQuickRangeDays } from '../lib/filters'

interface DateRangePresetsProps {
  range: { start: Date; end: Date }
  onChange: (range: { start: Date; end: Date }) => void
  /** `segmented` packs the presets into one control that sits on a toolbar. */
  variant?: 'default' | 'segmented'
}

export function DateRangePresets(props: DateRangePresetsProps) {
  const { t } = useTranslation()
  const selectedDays = detectQuickRangeDays(props.range.start, props.range.end)
  const segmented = props.variant === 'segmented'

  return (
    <div
      role='group'
      className={cn(
        'flex flex-wrap gap-1',
        segmented &&
          'border-border/70 bg-muted/60 inline-flex gap-0.5 rounded-lg border p-0.5'
      )}
      aria-label={t('Quick Range')}
    >
      {[
        { days: 0, label: t('Today') },
        { days: 1, label: t('Last 24 hours') },
        { days: 7, label: t('7 Days') },
        { days: 30, label: t('30 Days') },
      ].map((preset) => {
        const selected = selectedDays === preset.days
        let variant: 'ghost' | 'secondary' = 'ghost'
        if (!segmented && selected) variant = 'secondary'
        return (
          <Button
            key={preset.days}
            variant={variant}
            size={segmented ? 'xs' : 'sm'}
            aria-pressed={selected}
            className={cn(
              segmented &&
                'text-muted-foreground hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs dark:aria-pressed:bg-input/40 hover:aria-pressed:bg-background'
            )}
            onClick={() => props.onChange(getRollingDateRange(preset.days))}
          >
            {preset.label}
          </Button>
        )
      })}
    </div>
  )
}
