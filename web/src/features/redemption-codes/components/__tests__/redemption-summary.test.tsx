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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import en from '@/i18n/locales/en.json'
import { api } from '@/lib/api'
import { Route as RedemptionCodesRoute } from '@/routes/_authenticated/redemption-codes/index'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { Redemption, RedemptionSummary } from '../../types'
import { RedemptionsProvider } from '../redemptions-provider'
import { RedemptionsSummaryCards } from '../redemptions-summary-cards'
import { RedemptionsTable } from '../redemptions-table'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en } })

// Tokens display keeps quota assertions exact instead of currency rounding.
function useTokensDisplay() {
  useSystemConfigStore.getState().setConfig({
    currency: {
      displayInCurrency: true,
      quotaDisplayType: 'TOKENS',
      quotaPerUnit: 500000,
      usdExchangeRate: 1,
      customCurrencySymbol: '¤',
      customCurrencyExchangeRate: 1,
    },
  })
}

const summaryFixture: RedemptionSummary = {
  total: 6,
  used: 1,
  available: 2,
  expired: 1,
  disabled: 1,
  refunded: 1,
  paid: 1,
  reward: 5,
  issued_quota: 510,
  redeemed_quota: 200,
  redeemed_paid_quota: 0,
  redeemed_bonus_quota: 200,
  available_quota: 160,
  available_paid_quota: 100,
  available_bonus_quota: 60,
  expired_quota: 50,
  disabled_quota: 30,
  refunded_quota: 70,
}

function redemptionFixture(): Redemption {
  return {
    id: 1,
    user_id: 1,
    name: 'code-1',
    key: 'key-1',
    status: 1,
    quota: 100,
    paid_quota: 100,
    bonus_quota: 0,
    created_time: 1,
    redeemed_time: 0,
    expired_time: 0,
    used_user_id: 0,
    type: 'paid',
  }
}

function cardDetail(label: string): HTMLElement {
  const detail = screen.getByText(label).parentElement
  expect(detail).not.toBeNull()
  return detail as HTMLElement
}

beforeEach(() => {
  useTokensDisplay()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 100 })
})

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

it('shows counts, quota and redeemed rate from the summary', () => {
  render(
    <I18nextProvider i18n={i18n}>
      <RedemptionsSummaryCards
        summary={summaryFixture}
        loading={false}
        error={false}
      />
    </I18nextProvider>
  )

  expect(
    screen.getByText('Issued under the current filter')
  ).toBeInTheDocument()
  expect(
    screen.getByText('Quota already redeemed by users')
  ).toBeInTheDocument()
  expect(
    screen.getByText('Quota in unused codes that can still be redeemed')
  ).toBeInTheDocument()

  expect(cardDetail('Unused')).toHaveTextContent('2')
  expect(cardDetail('Used')).toHaveTextContent('1')
  expect(cardDetail('Expired')).toHaveTextContent('1')
  expect(cardDetail('Disabled')).toHaveTextContent('1')

  expect(screen.getByText('17%')).toBeInTheDocument()
  expect(screen.getByText('1 of 6 codes redeemed')).toBeInTheDocument()

  // Issued / available / refunded / expired / disabled quota totals.
  for (const quota of ['510', '160', '70', '50', '30']) {
    expect(screen.getByText(quota)).toBeInTheDocument()
  }
})

it('loads the summary for the list filters and shows counts in the status filter', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/redemption/summary') {
      return { data: { success: true, data: summaryFixture } }
    }
    return {
      data: {
        success: true,
        data: { items: [redemptionFixture()], total: 1, page: 1, page_size: 20 },
      },
    }
  })

  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const redemptionCodes = createRoute({
    getParentRoute: () => auth,
    path: 'redemption-codes/',
    validateSearch: RedemptionCodesRoute.options.validateSearch,
    component: () => (
      <TooltipProvider>
        <RedemptionsProvider>
          <RedemptionsTable />
        </RedemptionsProvider>
      </TooltipProvider>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([redemptionCodes])]),
    history: createMemoryHistory({ initialEntries: ['/redemption-codes/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  await router.load()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )

  await screen.findByText('code-1')
  expect(
    await screen.findByText('Issued under the current filter')
  ).toBeInTheDocument()
  expect(screen.getByText('17%')).toBeInTheDocument()
  expect(
    get.mock.calls.some(([url]) => url === '/api/redemption/summary')
  ).toBe(true)

  const user = userEvent.setup()
  const statusTrigger = screen
    .getAllByRole('button', { name: /^Status/ })
    .find((button) => button.getAttribute('aria-haspopup') === 'dialog')
  expect(statusTrigger).toBeDefined()
  await user.click(statusTrigger as HTMLElement)

  const unusedOption = await screen.findByRole('option', { name: /^Unused/ })
  expect(unusedOption).toHaveTextContent('2')
  client.clear()
})
