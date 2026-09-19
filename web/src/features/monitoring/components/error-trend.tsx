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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import dayjs from '@/lib/dayjs'
import { buildLogsDrilldownSearch } from '@/lib/logs-drilldown'
import { cn } from '@/lib/utils'

import type { LogAnalysisTrendPoint } from '../types'

interface ErrorTrendProps {
  points: LogAnalysisTrendPoint[]
  bucketSeconds: number
}

function formatBucketLabel(ts: number, bucketSeconds: number): string {
  const value = dayjs.unix(ts)
  if (bucketSeconds >= 86400) return value.format('MM-DD')
  if (bucketSeconds >= 3600) return value.format('MM-DD HH:mm')
  return value.format('HH:mm')
}

/**
 * Compact error-count timeline. Every bar links to the error logs for its own
 * time bucket, so the trend doubles as a drill-down control.
 */
export function ErrorTrend(props: ErrorTrendProps) {
  const { t } = useTranslation()
  const points = props.points
  const totalErrors = points.reduce((sum, point) => sum + point.error, 0)

  if (points.length === 0 || totalErrors === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        {t('No errors in this period')}
      </p>
    )
  }

  const maxError = Math.max(...points.map((point) => point.error))
  const firstPoint = points[0]
  const lastBucketTs =
    (points.at(-1)?.ts ?? firstPoint.ts) + props.bucketSeconds

  return (
    <div className='space-y-1.5'>
      <div className='flex h-20 items-end gap-px'>
        {points.map((point) => {
          const requests = point.consume + point.error
          const errorRate = requests > 0 ? (point.error / requests) * 100 : 0
          const bucketStart = new Date(point.ts * 1000)
          const bucketEnd = new Date(
            (point.ts + Math.max(props.bucketSeconds - 1, 0)) * 1000
          )
          const tooltip = t(
            'Errors: {{error}}, requests: {{request}}, error rate: {{rate}}%',
            {
              error: point.error,
              request: requests,
              rate: errorRate.toFixed(1),
            }
          )

          return (
            <Link
              key={point.ts}
              to='/usage-logs/$section'
              params={{ section: 'common' }}
              search={buildLogsDrilldownSearch({
                start: bucketStart,
                end: bucketEnd,
                errorOnly: true,
              })}
              className='group focus-visible:ring-ring flex h-full flex-1 items-end rounded-sm outline-none focus-visible:ring-2'
              title={tooltip}
              aria-label={tooltip}
            >
              <span
                className={cn(
                  'w-full rounded-t transition-colors',
                  point.error > 0
                    ? 'bg-destructive/60 group-hover:bg-destructive'
                    : 'bg-muted-foreground/20'
                )}
                style={{
                  height:
                    point.error > 0
                      ? `${Math.max((point.error / maxError) * 100, 5)}%`
                      : '2px',
                }}
              />
            </Link>
          )
        })}
      </div>
      <div className='text-muted-foreground flex justify-between font-mono text-[10px] tabular-nums'>
        <span>{formatBucketLabel(firstPoint.ts, props.bucketSeconds)}</span>
        <span>{formatBucketLabel(lastBucketTs, props.bucketSeconds)}</span>
      </div>
    </div>
  )
}
