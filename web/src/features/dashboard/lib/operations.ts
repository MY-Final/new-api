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
import dayjs from '@/lib/dayjs'
import type { TimeGranularity } from '@/lib/time'

import type {
  DashboardAnalytics,
  DashboardMetricStats,
  DashboardModelStats,
  DashboardTimeStats,
  QuotaDataItem,
} from '../types'

export function buildDashboardAnalytics(
  data: QuotaDataItem[],
  granularity: TimeGranularity,
  range: { start: Date; end: Date }
): DashboardAnalytics {
  const summary: DashboardMetricStats = { quota: 0, count: 0, tokens: 0 }
  const models = new Map<string, DashboardModelStats>()
  const timeline = new Map<number, DashboardTimeStats>()
  const start = dayjs(range.start).startOf(granularity)
  const end = dayjs(range.end).startOf(granularity)
  // Very long custom ranges keep their existing buckets rather than expanding
  // an arbitrarily large hourly timeline in the browser.
  if (end.diff(start, granularity) <= 1000) {
    for (
      let bucket = start;
      bucket.valueOf() <= end.valueOf();
      bucket = bucket.add(1, granularity)
    ) {
      const timestamp = bucket.unix()
      timeline.set(timestamp, { timestamp, quota: 0, count: 0, tokens: 0 })
    }
  }
  for (const item of data) {
    const model = item.model_name ?? ''
    const metrics = {
      quota: Number(item.quota) || 0,
      count: Number(item.count) || 0,
      tokens: Number(item.token_used) || 0,
    }
    const modelStats = models.get(model) ?? {
      model,
      quota: 0,
      count: 0,
      tokens: 0,
    }
    const timestamp = dayjs(item.created_at * 1000)
      .startOf(granularity)
      .unix()
    const bucket = timeline.get(timestamp) ?? {
      timestamp,
      quota: 0,
      count: 0,
      tokens: 0,
    }
    for (const metric of ['quota', 'count', 'tokens'] as const) {
      summary[metric] += metrics[metric]
      modelStats[metric] += metrics[metric]
      bucket[metric] += metrics[metric]
    }
    models.set(model, modelStats)
    timeline.set(timestamp, bucket)
  }
  return {
    summary,
    models: [...models.values()],
    timeline: [...timeline.values()].sort((a, b) => a.timestamp - b.timestamp),
  }
}
