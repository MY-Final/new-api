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

import { cn } from '@/lib/utils'

interface StatDeltaProps {
  current: number
  previous: number
  className?: string
}

/**
 * Period-over-period change for a stat card. Renders nothing when the previous
 * period has no data, so "new" metrics are not misreported as infinite growth.
 */
export function StatDelta(props: StatDeltaProps) {
  const { t } = useTranslation()
  if (
    !Number.isFinite(props.current) ||
    !Number.isFinite(props.previous) ||
    props.previous <= 0
  ) {
    return null
  }

  const change = ((props.current - props.previous) / props.previous) * 100
  const isUp = change > 0
  const isFlat = Math.abs(change) < 0.05
  const text = isFlat
    ? '0%'
    : `${isUp ? '↑' : '↓'}${Math.abs(change).toFixed(Math.abs(change) >= 100 ? 0 : 1)}%`

  let colorClass = 'text-muted-foreground/70'
  if (!isFlat) {
    colorClass = isUp
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400'
  }

  return (
    <span
      className={cn(
        'font-mono text-[11px] leading-4 tabular-nums',
        colorClass,
        props.className
      )}
      title={t('Compared with the previous period')}
    >
      {text}
    </span>
  )
}
