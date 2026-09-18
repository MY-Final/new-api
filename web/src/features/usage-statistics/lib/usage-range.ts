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
import { getNormalizedDateRange, getStartOfDay } from '@/lib/time'

export interface UsageDateRange {
  start: Date
  end: Date
}

const DAY_MS = 86_400_000

/**
 * Default statistics window: the last seven calendar days including today so
 * the trend charts render a full week of buckets instead of a few scattered
 * points.
 */
export function getDefaultUsageRange(
  fromDate: Date = new Date()
): UsageDateRange {
  return getNormalizedDateRange(6, fromDate)
}

/**
 * True when the selected range is exactly the current day so far (starts at
 * local midnight and reaches the current moment). A separate "Today" strip
 * would only repeat the period summary in that case, so the page hides it.
 */
export function isRangeCoveringToday(
  range: UsageDateRange,
  fromDate: Date = new Date()
): boolean {
  return (
    range.start.getTime() === getStartOfDay(fromDate).getTime() &&
    range.end.getTime() >= fromDate.getTime()
  )
}

function formatUtcDay(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

function toUtcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * Ordered day keys covering the range. The statistics API buckets usage by
 * UTC day (`YYYY-MM-DD`), so charts fill their gaps on the same axis.
 */
export function buildDailyTimeline(range: UsageDateRange): string[] {
  const days: string[] = []
  const end = toUtcDayStart(range.end)
  for (let time = toUtcDayStart(range.start); time <= end; time += DAY_MS) {
    days.push(formatUtcDay(time))
  }
  return days
}
