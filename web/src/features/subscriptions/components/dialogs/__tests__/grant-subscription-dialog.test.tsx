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

import { GrantSubscriptionDialog } from '../grant-subscription-dialog'

const mocks = vi.hoisted(() => ({
  createUserSubscription: vi.fn(),
  searchUsers: vi.fn(),
  setOpen: vi.fn(),
  triggerRefresh: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
  currentRow: {
    plan: {
      id: 7,
      title: 'DeepSeek Day Pass',
      price_amount: 6,
      currency: 'CNY',
      duration_unit: 'day',
      duration_value: 1,
      quota_reset_period: 'never',
      enabled: true,
      sort_order: 0,
      allow_balance_pay: true,
      allow_wallet_overflow: true,
      max_purchase_per_user: 0,
      total_amount: 0,
    },
  },
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

vi.mock('@/features/subscriptions/api', () => ({
  createUserSubscription: mocks.createUserSubscription,
}))

vi.mock('@/features/users/api', () => ({
  searchUsers: mocks.searchUsers,
}))

vi.mock('@/features/subscriptions/components/subscriptions-provider', () => ({
  useSubscriptions: () => ({
    open: 'grant-subscription',
    setOpen: mocks.setOpen,
    currentRow: mocks.currentRow,
    triggerRefresh: mocks.triggerRefresh,
    complianceConfirmed: true,
  }),
}))

const testUser = {
  id: 12,
  username: 'alice',
  display_name: 'Alice',
  group: 'default',
}

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  mocks.createUserSubscription.mockReset()
  mocks.searchUsers.mockReset()
  mocks.setOpen.mockReset()
  mocks.triggerRefresh.mockReset()
  mocks.toast.error.mockReset()
  mocks.toast.success.mockReset()
  mocks.searchUsers.mockResolvedValue({
    success: true,
    data: { items: [testUser] },
  })
})

function renderDialog() {
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <GrantSubscriptionDialog />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

async function selectUserAndReview() {
  const user = userEvent.setup()
  renderDialog()

  await user.click(screen.getByRole('combobox', { name: 'Target user' }))
  await user.click(await screen.findByRole('option', { name: /Alice/ }))
  await user.click(screen.getByRole('button', { name: 'Review grant' }))
  return user
}

describe('GrantSubscriptionDialog', () => {
  test('grants the selected plan without charging the user', async () => {
    mocks.createUserSubscription.mockResolvedValue({ success: true })
    const user = await selectUserAndReview()

    expect(
      screen.getByText('Grant "DeepSeek Day Pass" to Alice (@alice)?')
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Grant' }))

    await waitFor(() => {
      expect(mocks.createUserSubscription).toHaveBeenCalledWith(12, {
        plan_id: 7,
      })
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'Subscription granted successfully'
      )
    })
    expect(mocks.triggerRefresh).toHaveBeenCalledOnce()
    expect(mocks.setOpen).toHaveBeenCalledWith(null)
  })

  test('explains when the user already has a different active plan', async () => {
    mocks.createUserSubscription.mockRejectedValue({
      response: {
        status: 409,
        data: { success: false },
      },
    })
    const user = await selectUserAndReview()

    await user.click(screen.getByRole('button', { name: 'Grant' }))

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        'This user already has an active subscription for another plan. Cancel it before adding a different plan.'
      )
    })
    expect(mocks.triggerRefresh).not.toHaveBeenCalled()
    expect(mocks.setOpen).not.toHaveBeenCalled()
  })
})
