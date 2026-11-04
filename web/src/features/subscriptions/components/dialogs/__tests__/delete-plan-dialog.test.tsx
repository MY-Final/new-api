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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { DeletePlanDialog } from '../delete-plan-dialog'

const mocks = vi.hoisted(() => ({
  deletePlan: vi.fn(),
  setOpen: vi.fn(),
  triggerRefresh: vi.fn(),
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
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

vi.mock('@/features/subscriptions/api', () => ({
  deletePlan: mocks.deletePlan,
}))

vi.mock('@/features/subscriptions/components/subscriptions-provider', () => ({
  useSubscriptions: () => ({
    open: 'delete-plan',
    setOpen: mocks.setOpen,
    currentRow: mocks.currentRow,
    triggerRefresh: mocks.triggerRefresh,
    complianceConfirmed: true,
  }),
}))

beforeEach(() => {
  mocks.deletePlan.mockReset()
  mocks.setOpen.mockReset()
  mocks.triggerRefresh.mockReset()
  mocks.toast.error.mockReset()
  mocks.toast.success.mockReset()
})

function renderDialog() {
  return render(
    <I18nextProvider i18n={i18next}>
      <DeletePlanDialog />
    </I18nextProvider>
  )
}

describe('DeletePlanDialog', () => {
  test('deletes an unused plan and refreshes the plan list', async () => {
    const user = userEvent.setup()
    mocks.deletePlan.mockResolvedValue({ success: true })
    renderDialog()

    expect(
      screen.getByText('Delete subscription plan "DeepSeek Day Pass"?')
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocks.deletePlan).toHaveBeenCalledWith(7)
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'Subscription plan deleted successfully'
      )
    })
    expect(mocks.triggerRefresh).toHaveBeenCalledOnce()
    expect(mocks.setOpen).toHaveBeenCalledWith(null)
  })

  test('keeps a referenced plan and shows the server conflict', async () => {
    const user = userEvent.setup()
    mocks.deletePlan.mockRejectedValue({
      response: {
        status: 409,
        data: {
          success: false,
          message_key:
            'Subscription plans that have user subscriptions or orders cannot be deleted. Disable the plan instead.',
        },
      },
    })
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        'Subscription plans that have user subscriptions or orders cannot be deleted. Disable the plan instead.'
      )
    })
    expect(mocks.triggerRefresh).not.toHaveBeenCalled()
    expect(mocks.setOpen).not.toHaveBeenCalled()
  })
})
