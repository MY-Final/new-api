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

import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export function CacheHitProgress(props: {
  cacheRead: number
  inputTotal: number
  className?: string
}) {
  const { t } = useTranslation()
  const inputTotal = Math.max(props.inputTotal, 0)
  const cacheRead = Math.min(Math.max(props.cacheRead, 0), inputTotal)
  const percentage = inputTotal > 0 ? (cacheRead / inputTotal) * 100 : 0
  const percentageLabel = `${percentage.toFixed(1).replace(/\.0$/, '')}%`

  return (
    <div
      data-slot='token-composition-bar'
      className={cn('flex min-w-0 items-center gap-2', props.className)}
    >
      <Progress
        value={percentage}
        aria-label={t('Cache Hit Rate')}
        aria-valuetext={percentageLabel}
        className='[&_[data-slot=progress-indicator]]:bg-primary [&_[data-slot=progress-track]]:bg-muted min-w-0 flex-1 gap-0 [&_[data-slot=progress-indicator]]:rounded-full [&_[data-slot=progress-track]]:h-1.5'
      />
      <span
        className='text-foreground/80 shrink-0 font-mono text-[11px] font-medium tabular-nums'
        title={t('Cache Hit Rate')}
      >
        {percentageLabel}
      </span>
    </div>
  )
}
