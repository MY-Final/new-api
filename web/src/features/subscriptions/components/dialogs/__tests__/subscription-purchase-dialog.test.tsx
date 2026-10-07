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
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type { ComponentProps } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { PlanRecord } from '../../../types'
import { SubscriptionPurchaseDialog } from '../subscription-purchase-dialog'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

const planRecord: PlanRecord = {
  plan: {
    id: 1,
    title: 'Starter',
    price_amount: 10,
    currency: 'USD',
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
})
