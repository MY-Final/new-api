/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { afterEach, describe, expect, test } from 'vitest'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import {
  getEditableQuotaStep,
  parseQuotaFromDollars,
  quotaUnitsToEditableAmount,
} from '../format'

afterEach(() => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG },
  })
})

describe('editable quota amount conversion', () => {
  test('converts the default warning threshold to one USD', () => {
    useSystemConfigStore.getState().setConfig({
      currency: { ...DEFAULT_CURRENCY_CONFIG },
    })

    expect(quotaUnitsToEditableAmount(500000)).toBe(1)
    expect(parseQuotaFromDollars(2)).toBe(1000000)
    expect(getEditableQuotaStep()).toBe(0.0001)
  })

  test('converts a configured currency amount in both directions', () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 7.2,
      },
    })

    expect(quotaUnitsToEditableAmount(13888889)).toBe(200)
    expect(parseQuotaFromDollars(200)).toBe(13888889)
  })

  test('keeps token mode in quota units for legacy configurations', () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'TOKENS',
      },
    })

    expect(quotaUnitsToEditableAmount(500000)).toBe(500000)
    expect(parseQuotaFromDollars(500000)).toBe(500000)
    expect(getEditableQuotaStep()).toBe(1)
  })
})
