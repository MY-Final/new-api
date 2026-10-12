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

import {
  DEFAULT_DASHBOARD_CHART_PREFERENCES,
  DASHBOARD_CHART_PREFERENCES_STORAGE_KEY,
} from '@/features/dashboard/constants'

import {
  buildDefaultDashboardFilters,
  getDefaultDays,
  getSavedChartPreferences,
  detectQuickRangeDays,
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

  it('keeps saved range and chart preferences while migrating the ranking to cost', () => {
    localStorage.setItem(
      DASHBOARD_CHART_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        consumptionDistributionChart: 'bar',
        modelAnalyticsChart: 'proportion',
        defaultTimeRangeDays: 7,
        defaultTimeGranularity: 'day',
      })
    )
    expect(getSavedChartPreferences()).toEqual({
      consumptionDistributionChart: 'bar',
      modelRankingMetric: 'quota',
      defaultTimeRangeDays: 7,
      defaultTimeGranularity: 'day',
    })
  })

  it('keeps the hourly users analytics fallback on today', () => {
    expect(getDefaultDays('hour')).toBe(0)
  })

  it('highlights 30 days but leaves partial custom ranges unselected', () => {
    const end = new Date('2026-10-12T10:30:00Z')
    expect(detectQuickRangeDays(new Date('2026-09-12T10:30:00Z'), end)).toBe(30)
    expect(
      detectQuickRangeDays(new Date('2026-10-11T11:00:00Z'), end)
    ).toBeNull()
  })
})
