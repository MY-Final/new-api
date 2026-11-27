import { afterEach, describe, expect, test } from 'vitest'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { formatOverviewMoney } from '../lib/format'

afterEach(() => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG },
  })
})

describe('subscription overview money formatting', () => {
  test('applies the configured custom currency rate to USD amounts', () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CUSTOM',
        customCurrencySymbol: '🥚',
        customCurrencyExchangeRate: 1,
      },
    })

    expect(formatOverviewMoney(18, 'en-US')).toBe('🥚 18')
    expect(formatOverviewMoney(12.5, 'en-US')).toBe('🥚 12.5')
    expect(formatOverviewMoney(30, 'en-US')).toBe('🥚 30')
  })

  test('does not treat a USD amount as already converted custom currency', () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CUSTOM',
        customCurrencySymbol: '🥚',
        customCurrencyExchangeRate: 7.3,
      },
    })

    expect(formatOverviewMoney(30, 'en-US')).toBe('🥚 219')
    expect(formatOverviewMoney(0.0192, 'en-US')).toBe('🥚 0.14016')
  })

  test('keeps precision for sub-unit upstream costs instead of showing zero', () => {
    expect(formatOverviewMoney(0.000285, 'en-US')).toBe('🥚 0.000285')
  })

  test('never displays monetary overview values as token counts', () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'TOKENS',
        quotaPerUnit: 500000,
      },
    })

    expect(formatOverviewMoney(30, 'en-US')).toBe('$30')
  })

  test('returns a placeholder for missing values', () => {
    expect(formatOverviewMoney(undefined, 'en-US')).toBe('-')
    expect(formatOverviewMoney(Number.NaN, 'en-US')).toBe('-')
  })
})
