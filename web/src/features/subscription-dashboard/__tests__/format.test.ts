import { describe, expect, test, vi } from 'vitest'

import { formatOverviewMoney } from '../lib/format'

vi.mock('@/lib/currency', () => ({
  getCurrencyLabel: () => '🥚',
}))

describe('subscription overview money formatting', () => {
  test('shows whole and fractional order amounts with the display label', () => {
    expect(formatOverviewMoney(18, 'en-US')).toBe('18 🥚')
    expect(formatOverviewMoney(12.5, 'en-US')).toBe('12.5 🥚')
  })

  test('keeps precision for sub-unit upstream costs instead of showing zero', () => {
    expect(formatOverviewMoney(0.000285, 'en-US')).toBe('0.000285 🥚')
  })

  test('returns a placeholder for missing values', () => {
    expect(formatOverviewMoney(undefined, 'en-US')).toBe('-')
    expect(formatOverviewMoney(Number.NaN, 'en-US')).toBe('-')
  })
})
