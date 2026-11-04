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
import i18next from 'i18next'
import { describe, expect, test } from 'vitest'

import { formatPlanPrice, formatWindowDuration } from '../format'

describe('subscription formatting', () => {
  test('formats CNY and USD plan prices with each locale', () => {
    expect(formatPlanPrice(6, 'CNY', 'zh-CN')).toBe('¥6.00')
    expect(formatPlanPrice(6, 'USD', 'en-US')).toBe('$6.00')
  })

  test('falls back to CNY for plans created without a currency', () => {
    expect(formatPlanPrice(6, '', 'en-US')).toBe('CN¥6.00')
  })

  test('formats rolling window durations in their largest whole unit', () => {
    expect(formatWindowDuration(5 * 60 * 60, i18next.t)).toBe('5 hours')
    expect(formatWindowDuration(7 * 24 * 60 * 60, i18next.t)).toBe('7 days')
    expect(formatWindowDuration(90, i18next.t)).toBe('90 seconds')
  })
})
