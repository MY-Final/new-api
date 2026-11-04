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
import type { ComponentProps } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { PlanRecord } from '../../../types'
import { SubscriptionPurchaseDialog } from '../subscription-purchase-dialog'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  paySubscriptionBalance: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

vi.mock('@/features/subscriptions/api', () => ({
  paySubscriptionBalance: mocks.paySubscriptionBalance,
  paySubscriptionCreem: vi.fn(),
  paySubscriptionEpay: vi.fn(),
  paySubscriptionStripe: vi.fn(),
  paySubscriptionWaffoPancake: vi.fn(),
}))

const planRecord: PlanRecord = {
  plan: {
    id: 1,
    title: 'Starter',
    price_amount: 10,
    currency: 'CNY',
    duration_unit: 'month',
    duration_value: 1,
    quota_reset_period: 'monthly',
    enabled: true,
    sort_order: 0,
    allow_balance_pay: true,
    allow_wallet_overflow: true,
    max_purchase_per_user: 0,
    total_amount: 1_000_000,
    stripe_price_id: 'price_starter',
  },
}

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  mocks.navigate.mockReset()
  mocks.paySubscriptionBalance.mockReset()
  mocks.toast.error.mockReset()
  mocks.toast.success.mockReset()
})

function renderDialog(
  overrides: Partial<ComponentProps<typeof SubscriptionPurchaseDialog>> = {}
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <SubscriptionPurchaseDialog
          open
          onOpenChange={vi.fn()}
          plan={planRecord}
          userQuota={0}
          enableStripe
          {...overrides}
        />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

describe('SubscriptionPurchaseDialog', () => {
  test('renders plan currency, rolling windows, and concurrency from the snapshot', () => {
    renderDialog({
      plan: {
        plan: {
          ...planRecord.plan,
          price_amount: 6,
          currency: 'CNY',
          quota_windows: [
            { window_seconds: 5 * 60 * 60, quota_limit: 300, sort_order: 0 },
            { window_seconds: 7 * 24 * 60 * 60, quota_limit: 700, sort_order: 1 },
          ],
          max_concurrency: 3,
        },
      },
    })

    expect(screen.getByText(/6\.00/)).toBeVisible()
    expect(screen.getByText('5 hours')).toBeVisible()
    expect(screen.getByText('7 days')).toBeVisible()
    expect(screen.getByText('Account Concurrency')).toBeVisible()
    expect(screen.getByText('3')).toBeVisible()
    expect(screen.queryByText('$6.00')).not.toBeInTheDocument()
  })

  test('warns about explicit key groups and opens the key creation page', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    renderDialog({
      onOpenChange,
      plan: {
        plan: { ...planRecord.plan, upgrade_group: 'deepseek-day' },
      },
    })

    expect(
      screen.getByText(
        /Only API keys with an empty or Auto group follow your purchased subscription group/
      )
    ).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Create an Auto group API Key' })
    )

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/keys' })
  })

  test('reports renewal when the balance purchase extends the same plan', async () => {
    const onPurchaseSuccess = vi.fn()
    const user = userEvent.setup()
    mocks.paySubscriptionBalance.mockResolvedValue({
      success: true,
      data: { renewed: true },
    })
    renderDialog({
      userQuota: 100_000_000,
      onPurchaseSuccess,
    })

    await user.click(screen.getByRole('button', { name: 'Pay with Balance' }))

    await waitFor(() => {
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'Subscription renewed successfully'
      )
    })
    expect(onPurchaseSuccess).toHaveBeenCalledOnce()
  })

  test('shows the different-plan conflict returned by the balance purchase', async () => {
    const user = userEvent.setup()
    mocks.paySubscriptionBalance.mockRejectedValue({
      response: { status: 409 },
    })
    renderDialog({ userQuota: 100_000_000 })

    await user.click(screen.getByRole('button', { name: 'Pay with Balance' }))

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        'You already have an active subscription for another plan. Wait until it expires or ask an administrator to cancel it before purchasing this plan.'
      )
    })
  })

  test('offers Add Funds for an insufficient balance, closes, and navigates to the wallet', async () => {
    const calls: string[] = []
    const onOpenChange = vi.fn(() => calls.push('close'))
    mocks.navigate.mockImplementation(() => calls.push('navigate'))
    const user = userEvent.setup()

    renderDialog({ onOpenChange })

    const addFunds = screen.getByRole('button', { name: 'Add Funds' })
    expect(addFunds).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Pay with Balance' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stripe' })).toBeVisible()

    await user.click(addFunds)

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/wallet' })
    expect(calls).toEqual(['close', 'navigate'])
  })

  test('does not offer Add Funds when balance payment is disallowed', () => {
    renderDialog({
      plan: {
        plan: { ...planRecord.plan, allow_balance_pay: false },
      },
    })

    expect(
      screen.queryByRole('button', { name: 'Add Funds' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Pay with Balance' })
    ).toBeDisabled()
    expect(
      screen.getByText('This plan does not allow balance redemption')
    ).toBeVisible()
  })

  test('disables balance payment for plans denominated in another currency', () => {
    renderDialog({
      plan: {
        plan: { ...planRecord.plan, currency: 'USD' },
      },
    })

    expect(
      screen.getByText('Balance payment is available only for CNY plans')
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Pay with Balance' })
    ).toBeDisabled()
  })
})
