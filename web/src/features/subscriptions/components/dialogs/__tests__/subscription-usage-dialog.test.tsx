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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { SubscriptionUsageDialog } from '../subscription-usage-dialog'

const mocks = vi.hoisted(() => ({
  getSelfSubscriptionUsage: vi.fn(),
  getSelfSubscriptionUsageStatistics: vi.fn(),
}))

vi.mock('@/features/subscriptions/api', () => ({
  getSelfSubscriptionUsage: mocks.getSelfSubscriptionUsage,
  getSelfSubscriptionUsageStatistics: mocks.getSelfSubscriptionUsageStatistics,
}))

vi.mock('../../subscription-usage-chart', () => ({
  SubscriptionUsageChart: () => <div>Usage trend chart</div>,
}))

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  mocks.getSelfSubscriptionUsage.mockReset()
  mocks.getSelfSubscriptionUsageStatistics.mockReset()
  mocks.getSelfSubscriptionUsageStatistics.mockResolvedValue({
    success: true,
    data: {
      used_quota: 100,
      wallet_used_quota: 40,
      subscription_used_quota: 60,
      request_count: 10,
      wallet_request_count: 4,
      subscription_request_count: 6,
      today: {
        start_time: 1_700_000_000,
        end_time: 1_700_086_400,
        quota: 10,
        wallet_quota: 4,
        subscription_quota: 6,
        request_count: 2,
        wallet_request_count: 1,
        subscription_request_count: 1,
        refunded_quota: 0,
        refunded_request_count: 0,
      },
      last_7_days: {
        start_time: 1_699_482_400,
        end_time: 1_700_086_400,
        quota: 40,
        wallet_quota: 10,
        subscription_quota: 30,
        request_count: 5,
        wallet_request_count: 2,
        subscription_request_count: 3,
        refunded_quota: 0,
        refunded_request_count: 0,
      },
      last_30_days: {
        start_time: 1_697_496_400,
        end_time: 1_700_086_400,
        quota: 100,
        wallet_quota: 40,
        subscription_quota: 60,
        request_count: 10,
        wallet_request_count: 4,
        subscription_request_count: 6,
        refunded_quota: 5,
        refunded_request_count: 1,
      },
      daily: [],
      refunded_quota: 5,
      refunded_request_count: 1,
      pending_request_count: 2,
      pending_quota: 7,
      subscription_purchase_count: 2,
      subscription_purchase_spend: [{ currency: 'CNY', amount: 15, count: 2 }],
      filter_options: {
        models: ['gpt-test'],
        subscriptions: [{ id: 42, plan_title: 'Daily Pass' }],
        tokens: [{ id: 11, name: 'CLI' }],
        channels: [{ id: 7, name: 'Primary channel' }],
      },
    },
  })
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
            token_id: 11,
            token_name: 'CLI',
            channel_id: 7,
            channel_name: 'Primary channel',
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
    expect(screen.getByText('Refunded quota: 🥚 0.025')).toBeVisible()
    expect(screen.getByText('Token: CLI')).toBeVisible()
    expect(screen.getByText('Channel: Primary channel')).toBeVisible()
    expect(screen.getByText('request-one')).toBeVisible()
  })

  test('shows usage overview, trend, filters, and settlement details', async () => {
    mocks.getSelfSubscriptionUsage.mockResolvedValue({
      success: true,
      data: { page: 1, page_size: 10, total: 0, items: [] },
    })

    renderDialog()

    expect(await screen.findByText('Total Usage')).toBeVisible()
    expect(screen.getByText('Last 30 Days')).toBeVisible()
    expect(screen.getByText('Usage trend chart')).toBeVisible()
    expect(screen.getByText('Refunds (30 days)')).toBeVisible()
    expect(screen.getByText('Pending settlement')).toBeVisible()
    expect(screen.getByText('Subscription purchases')).toBeVisible()
    expect(screen.getByText('Filters')).toBeVisible()
    expect(screen.getByText('All models')).toBeVisible()
    expect(screen.getByText('All subscriptions')).toBeVisible()
    expect(screen.getByText('All tokens')).toBeVisible()
    expect(screen.getByText('All channels')).toBeVisible()
  })

  test('reloads the record list when a model filter is selected', async () => {
    const user = userEvent.setup()
    mocks.getSelfSubscriptionUsage.mockResolvedValue({
      success: true,
      data: { page: 1, page_size: 10, total: 0, items: [] },
    })

    renderDialog()

    await user.click(await screen.findByRole('combobox', { name: 'Model' }))
    await user.click(await screen.findByRole('option', { name: 'gpt-test' }))

    await waitFor(() =>
      expect(mocks.getSelfSubscriptionUsage).toHaveBeenLastCalledWith(1, 10, {
        modelName: 'gpt-test',
      })
    )
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
