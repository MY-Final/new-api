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
import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { SubscriptionUsageDialog } from '../subscription-usage-dialog'

const mocks = vi.hoisted(() => ({
  getSelfSubscriptionUsage: vi.fn(),
}))

vi.mock('@/features/subscriptions/api', () => ({
  getSelfSubscriptionUsage: mocks.getSelfSubscriptionUsage,
}))

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  mocks.getSelfSubscriptionUsage.mockReset()
})

function renderDialog() {
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <SubscriptionUsageDialog open onOpenChange={vi.fn()} />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

describe('SubscriptionUsageDialog', () => {
  test('shows the plan, model, net quota, and refund state of a usage record', async () => {
    mocks.getSelfSubscriptionUsage.mockResolvedValue({
      success: true,
      data: {
        page: 1,
        page_size: 10,
        total: 1,
        items: [
          {
            billing_id: 'billing-one',
            request_id: 'request-one',
            subscription_id: 42,
            plan_id: 7,
            plan_title: 'Daily Pass',
            model_name: 'gpt-test',
            quota: 0,
            refunded_quota: 12500,
            created_at: 1_700_000_000,
          },
        ],
      },
    })

    renderDialog()

    expect(await screen.findByText('gpt-test')).toBeVisible()
    expect(screen.getByText(/Daily Pass/)).toBeVisible()
    expect(screen.getByText('Refunded')).toBeVisible()
    expect(screen.getByText('request-one')).toBeVisible()
  })

  test('renders the empty state when the subscription has no usage', async () => {
    mocks.getSelfSubscriptionUsage.mockResolvedValue({
      success: true,
      data: { page: 1, page_size: 10, total: 0, items: [] },
    })

    renderDialog()

    expect(
      await screen.findByText('No subscription usage records')
    ).toBeVisible()
  })
})
