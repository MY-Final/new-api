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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_DASHBOARD_CHART_PREFERENCES } from '@/features/dashboard/constants'

import {
  buildDefaultDashboardFilters,
  getDefaultDays,
  getSavedChartPreferences,
} from '../filters'

describe('dashboard default time range', () => {
  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('opens model analytics on the current calendar day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 18, 14, 30, 0))

    const filters = buildDefaultDashboardFilters(
      DEFAULT_DASHBOARD_CHART_PREFERENCES
    )

    expect(filters.start_timestamp).toEqual(new Date(2026, 8, 18, 0, 0, 0, 0))
    expect(filters.end_timestamp).toEqual(new Date(2026, 8, 18, 14, 30, 0))
    expect(filters.time_granularity).toBe('hour')
  })

  it('falls back to today when no chart preferences are saved', () => {
    expect(getSavedChartPreferences().defaultTimeRangeDays).toBe(0)
  })

  it('keeps the hourly users analytics fallback on today', () => {
    expect(getDefaultDays('hour')).toBe(0)
  })
})
