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
import { cleanup, render, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import type { UserUsageDaily } from '@/features/users/types'

import { UsageChart } from '../usage-chart'

/** The slice of the chart spec this suite asserts on. */
type CapturedTooltipSpec = {
  tooltip: {
    activeType?: string
    dimension?: { visible?: boolean }
    mark: {
      content: Array<{
        key: string
        value: (datum: { day: string; value: number }) => string
      }>
    }
  }
}

const captured = vi.hoisted(() => ({
  spec: null as CapturedTooltipSpec | null,
}))

vi.mock('@visactor/react-vchart', () => ({
  VChart: (props: { spec: unknown }) => {
    captured.spec = props.spec as CapturedTooltipSpec
    return null
  },
}))

vi.mock('@/lib/use-chart-theme', () => ({
  useChartTheme: () => ({ resolvedTheme: 'light', themeReady: true }),
}))

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en } })

const day: UserUsageDaily = {
  day: '2026-10-07',
  request_count: 161,
  prompt_tokens: 0,
  completion_tokens: 0,
  input_tokens: 1_465_189_648,
  output_tokens: 8_788_554,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 4_424_958,
  consumed_quota: 4_424_958,
  refunded_quota: 0,
  net_quota: 4_424_958,
  // Quota units: 500,000 per USD in the default configuration.
  user_cost: 4_424_958,
}

beforeEach(() => {
  // State the currency explicitly: the app default is a site setting.
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      quotaDisplayType: 'USD',
      usdExchangeRate: 1,
      customCurrencySymbol: '¤',
      customCurrencyExchangeRate: 1,
    },
  })
})

afterEach(() => {
  cleanup()
  captured.spec = null
})

async function renderChart(metric: 'cost' | 'tokens') {
  render(
    <I18nextProvider i18n={i18n}>
      <UsageChart
        data={[day]}
        metric={metric}
        title={metric === 'cost' ? 'Cost Trend' : 'Token Trend'}
        color='#16a34a'
      />
    </I18nextProvider>
  )
  await waitFor(() => expect(captured.spec).not.toBeNull())
  return captured.spec as CapturedTooltipSpec
}

it('shows the cost trend tooltip as money instead of the raw quota value', async () => {
  const spec = await renderChart('cost')
  const tooltip = spec.tooltip

  // Without this the single-series line falls back to VChart's dimension
  // tooltip, which printed the raw quota value (4424958) for cost.
  expect(tooltip.activeType).toBe('mark')
  expect(tooltip.dimension?.visible).toBe(false)

  const line = tooltip.mark.content[0]
  expect(line.value({ day: day.day, value: day.user_cost })).toBe('$8.85')
})

it('keeps the token trend tooltip grouped and exact', async () => {
  const spec = await renderChart('tokens')

  const line = spec.tooltip.mark.content[0]
  expect(line.value({ day: day.day, value: day.total_tokens })).toBe(
    '4,424,958'
  )
})
