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
import { act, render, screen, within } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { buildDashboardAnalytics } from '../../../lib/operations'
import { LogStatCards } from '../log-stat-cards'

const data = buildDashboardAnalytics(
  [
    {
      created_at: 1735689600,
      model_name: 'model-a',
      count: 10,
      quota: 100,
      token_used: 1000,
    },
  ],
  'hour',
  { start: new Date(1735689600000), end: new Date(1735693200000) }
)

describe('operations summary cards', () => {
  beforeEach(() => {
    const store = useSystemConfigStore.getState()
    store.setConfig({
      currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
    })
  })
  afterEach(async () => {
    await i18next.changeLanguage('en')
    i18next.removeResourceBundle('zhCN', 'translation')
    const store = useSystemConfigStore.getState()
    store.setConfig({ currency: DEFAULT_CURRENCY_CONFIG })
  })

  test('updates monetary values when the configured currency changes after load', () => {
    const usage = { ...data, summary: { ...data.summary, quota: 500000 } }
    render(<LogStatCards data={usage} loading={false} error={false} />)
    const card = screen.getByRole('region', { name: 'User quota consumption' })
    expect(within(card).getByText('$1')).toBeVisible()
    const store = useSystemConfigStore.getState()
    act(() => {
      store.setConfig({
        currency: {
          ...DEFAULT_CURRENCY_CONFIG,
          quotaDisplayType: 'CNY',
          usdExchangeRate: 7,
        },
      })
    })
    expect(within(card).getByText('¥7')).toBeVisible()
  })

  test('switches labels and number formatting to the chosen interface language', async () => {
    i18next.addResourceBundle('zhCN', 'translation', zh.translation)
    render(<LogStatCards data={data} loading={false} error={false} />)
    await act(async () => {
      await i18next.changeLanguage('zhCN')
    })
    expect(screen.getByRole('region', { name: '用户消耗' })).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: '请求数' })).getByText('10')
    ).toBeVisible()
  })

  test('shows consumption, requests and tokens without duplicating RPM and TPM', () => {
    render(
      <LogStatCards
        data={data}
        previous={{ count: 5, quota: 50, tokens: 500 }}
        loading={false}
        error={false}
      />
    )
    expect(screen.getAllByText('↑100%')).toHaveLength(3)
    expect(
      within(screen.getByRole('region', { name: 'Requests' })).getByText('10')
    ).toBeVisible()
    expect(screen.queryByText('Average RPM')).not.toBeInTheDocument()
    expect(screen.queryByText('Average TPM')).not.toBeInTheDocument()
  })

  test('omits growth when the previous period has no usage', () => {
    render(
      <LogStatCards
        data={data}
        previous={{ count: 0, quota: 0, tokens: 0 }}
        loading={false}
        error={false}
      />
    )
    expect(screen.queryByText('↑100%')).not.toBeInTheDocument()
  })

  test('shows unknown values rather than zero totals when loading fails', () => {
    render(<LogStatCards data={data} loading={false} error />)
    expect(screen.getAllByText('--')).toHaveLength(3)
    expect(screen.queryByText('10')).not.toBeInTheDocument()
  })
})
