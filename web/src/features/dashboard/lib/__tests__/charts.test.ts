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
import { describe, expect, test } from 'vitest'

import type { QuotaDataItem } from '@/features/dashboard/types'
import type { TimeGranularity } from '@/lib/time'

import { processChartData, processUserChartData } from '../charts'
import { buildDashboardAnalytics } from '../operations'

const cases: Array<{
  granularity: TimeGranularity
  start: string
  interval: number
  labels: string[]
}> = [
  {
    granularity: 'hour',
    start: '2025-12-31T20:00:00',
    interval: 3600,
    labels: [
      '12-31 20:00',
      '12-31 21:00',
      '12-31 22:00',
      '12-31 23:00',
      '01-01 00:00',
      '01-01 01:00',
      '01-01 02:00',
      '01-01 03:00',
    ],
  },
  {
    granularity: 'day',
    start: '2025-12-27T12:00:00',
    interval: 86400,
    labels: [
      '12-27',
      '12-28',
      '12-29',
      '12-30',
      '12-31',
      '01-01',
      '01-02',
      '01-03',
    ],
  },
  {
    granularity: 'week',
    start: '2025-11-29T12:00:00',
    interval: 604800,
    labels: [
      '11-29 - 12-05',
      '12-06 - 12-12',
      '12-13 - 12-19',
      '12-20 - 12-26',
      '12-27 - 01-02',
      '01-03 - 01-09',
      '01-10 - 01-16',
      '01-17 - 01-23',
    ],
  },
]

function unorderedUsage(start: string, interval: number): QuotaDataItem[] {
  const first = new Date(start).getTime() / 1000
  const rows = Array.from({ length: 8 }, (_, i) => ({
    created_at: first + i * interval,
    model_name: 'model-a',
    username: 'alice',
    quota: (i + 1) * 500000,
    count: i + 1,
  }))
  // Same hour, or a second hourly record within the same day/week label.
  const duplicate = {
    ...rows[0],
    created_at: first + (interval === 3600 ? 0 : 3600),
    quota: 5000000,
    count: 10,
  }
  return [
    rows[7],
    rows[2],
    duplicate,
    rows[5],
    rows[0],
    rows[6],
    rows[1],
    rows[4],
    rows[3],
  ]
}

describe.each(cases)('dashboard $granularity chart chronology', (scenario) => {
  test('orders model buckets across New Year while aggregating repeated labels', () => {
    const data = unorderedUsage(scenario.start, scenario.interval)
    const original = structuredClone(data)
    const result = processChartData(data, scenario.granularity)

    for (const key of ['spec_line', 'spec_area', 'spec_model_line'] as const) {
      const values: Array<{ Time: string; rawQuota: number; Count: number }> =
        result[key].data[0].values
      expect(values.map((row) => row.Time)).toEqual(scenario.labels)
      expect(
        values.map((row) =>
          key === 'spec_model_line' ? row.Count : row.rawQuota / 500000
        )
      ).toEqual([11, 2, 3, 4, 5, 6, 7, 8])
    }
    expect(data).toEqual(original)
  })

  test('orders user buckets across New Year while aggregating repeated labels', () => {
    const data = unorderedUsage(scenario.start, scenario.interval)
    const original = structuredClone(data)
    const result = processUserChartData(data, scenario.granularity)
    const values: Array<{ Time: string; rawQuota: number }> =
      result.spec_user_trend.data[0].values

    expect(values.map((row) => row.Time)).toEqual(scenario.labels)
    expect(values.map((row) => row.rawQuota / 500000)).toEqual([
      11, 2, 3, 4, 5, 6, 7, 8,
    ])
    expect(data).toEqual(original)
  })

  test('keeps the existing seven padded model buckets in chronological order', () => {
    const data = [unorderedUsage(scenario.start, scenario.interval)[0]]
    const result = processChartData(data, scenario.granularity)

    for (const key of ['spec_line', 'spec_area', 'spec_model_line'] as const) {
      const values: Array<{ Time: string; rawQuota: number; Count: number }> =
        result[key].data[0].values
      expect(values.map((row) => row.Time)).toEqual(scenario.labels.slice(1))
      expect(
        values.map((row) =>
          key === 'spec_model_line' ? row.Count : row.rawQuota / 500000
        )
      ).toEqual([0, 0, 0, 0, 0, 0, 8])
    }
  })
})

describe('operations analytics', () => {
  test('aggregates all models while preserving the selected range and idle hours across New Year', () => {
    const range = {
      start: new Date('2025-12-31T23:30:00'),
      end: new Date('2026-01-01T02:30:00'),
    }
    const first = new Date('2025-12-31T23:00:00').getTime() / 1000
    const data: QuotaDataItem[] = [
      {
        created_at: first + 10800,
        model_name: 'b',
        quota: 20,
        count: 1,
        token_used: 40,
      },
      {
        created_at: first,
        model_name: 'a',
        quota: 10,
        count: 2,
        token_used: 30,
      },
      {
        created_at: first,
        model_name: 'b',
        quota: 30,
        count: 3,
        token_used: 50,
      },
    ]
    const analytics = buildDashboardAnalytics(data, 'hour', range)
    expect(analytics.summary).toEqual({ quota: 60, count: 6, tokens: 120 })
    expect(analytics.models.find((model) => model.model === 'b')).toEqual({
      model: 'b',
      quota: 50,
      count: 4,
      tokens: 90,
    })
    expect(analytics.timeline.map((point) => point.timestamp)).toEqual([
      first,
      first + 3600,
      first + 7200,
      first + 10800,
    ])
    expect(analytics.timeline.map((point) => point.quota)).toEqual([
      40, 0, 0, 20,
    ])
  })

  test('keeps empty usage empty without inventing model statistics', () => {
    const result = buildDashboardAnalytics([], 'day', {
      start: new Date('2026-10-10T00:00:00'),
      end: new Date('2026-10-11T00:00:00'),
    })
    expect(result.models).toEqual([])
    expect(result.summary).toEqual({ quota: 0, count: 0, tokens: 0 })
    expect(result.timeline.map((point) => point.quota)).toEqual([0, 0])
  })
})
