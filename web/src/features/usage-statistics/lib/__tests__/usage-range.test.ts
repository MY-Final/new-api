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
import { describe, expect, it } from 'vitest'

import {
  buildDailyTimeline,
  getDefaultUsageRange,
  isRangeCoveringToday,
} from '../usage-range'

describe('usage statistics date range', () => {
  it('defaults to the last seven calendar days including today', () => {
    const now = new Date(2026, 8, 18, 14, 30, 0)
    const range = getDefaultUsageRange(now)

    expect(range.start).toEqual(new Date(2026, 8, 12, 0, 0, 0, 0))
    expect(range.end).toEqual(new Date(2026, 8, 18, 23, 59, 59, 999))
  })

  it('detects ranges that already cover the whole current day', () => {
    const now = new Date(2026, 8, 18, 14, 30, 0)

    expect(
      isRangeCoveringToday(
        { start: new Date(2026, 8, 18, 0, 0), end: now },
        now
      )
    ).toBe(true)
    expect(
      isRangeCoveringToday(
        {
          start: new Date(2026, 8, 18, 0, 0),
          end: new Date(2026, 8, 18, 23, 59, 59, 999),
        },
        now
      )
    ).toBe(true)
    expect(
      isRangeCoveringToday(
        { start: new Date(2026, 8, 12, 0, 0), end: now },
        now
      )
    ).toBe(false)
    expect(
      isRangeCoveringToday(
        { start: new Date(2026, 8, 18, 12, 0), end: now },
        now
      )
    ).toBe(false)
    expect(
      isRangeCoveringToday(
        {
          start: new Date(2026, 8, 18, 0, 0),
          end: new Date(2026, 8, 18, 10, 0),
        },
        now
      )
    ).toBe(false)
  })

  it('builds a contiguous UTC day axis for the selected range', () => {
    expect(
      buildDailyTimeline({
        start: new Date(Date.UTC(2026, 8, 12)),
        end: new Date(Date.UTC(2026, 8, 14)),
      })
    ).toEqual(['2026-09-12', '2026-09-13', '2026-09-14'])

    expect(
      buildDailyTimeline({
        start: new Date(Date.UTC(2026, 8, 18, 23, 0)),
        end: new Date(Date.UTC(2026, 8, 19, 1, 0)),
      })
    ).toEqual(['2026-09-18', '2026-09-19'])
  })
})
