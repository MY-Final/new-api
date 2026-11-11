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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { getAdminPlans } from '@/features/subscriptions/api'
import type { PlanRecord } from '@/features/subscriptions/types'

import { SubscriptionsTable } from '../subscriptions-table'

const mocks = vi.hoisted(() => ({
  refreshTrigger: 0,
}))

vi.mock('@/features/subscriptions/api', () => ({
  getAdminPlans: vi.fn(),
}))

vi.mock('../subscriptions-provider', () => ({
  useSubscriptions: () => ({
    refreshTrigger: mocks.refreshTrigger,
  }),
}))

const i18n = i18next.createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

function plan(title: string): PlanRecord {
  return {
    plan: {
      id: 7,
      title,
      price_amount: 30,
      currency: 'CNY',
      duration_unit: 'month',
      duration_value: 1,
      quota_reset_period: 'never',
      enabled: true,
      sort_order: 1,
      allow_balance_pay: true,
      allow_wallet_overflow: false,
      max_purchase_per_user: 0,
      max_concurrency: 0,
      max_output_tokens: 393216,
      total_amount: 150,
      quota_windows: [],
      route_groups: ['sub'],
      route_group_ratios: { sub: 1 },
    },
  }
}

beforeEach(() => {
  mocks.refreshTrigger = 0
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

test('loads the current plans when entering the page with cached plan data', async () => {
  vi.mocked(getAdminPlans).mockResolvedValue({
    success: true,
    data: [plan('Current plan')],
  })
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  })
  client.setQueryData(['admin-subscription-plans', 0], [plan('Old plan')])

  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SubscriptionsTable />
      </QueryClientProvider>
    </I18nextProvider>
  )

  expect(await screen.findByText('Current plan')).toBeVisible()
  expect(screen.queryByText('Old plan')).not.toBeInTheDocument()
})
