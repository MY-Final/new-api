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
import { beforeEach, expect, test, vi } from 'vitest'

import type { PlanRecord } from '@/features/subscriptions/types'

import { SubscriptionsMutateDrawer } from '../subscriptions-mutate-drawer'

const mocks = vi.hoisted(() => ({
  getGroups: vi.fn(),
  updatePlan: vi.fn(),
  listProductOptions: vi.fn(),
  triggerRefresh: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

vi.mock('@/features/subscriptions/api', () => ({
  createPlan: vi.fn(),
  getGroups: mocks.getGroups,
  updatePlan: mocks.updatePlan,
  createWaffoPancakeSubscriptionProduct: vi.fn(),
  listWaffoPancakeSubscriptionProductOptions: mocks.listProductOptions,
}))

vi.mock('../subscriptions-provider', () => ({
  useSubscriptions: () => ({ triggerRefresh: mocks.triggerRefresh }),
}))

const i18n = i18next.createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

function planRecord(ratio: number): PlanRecord {
  return {
    plan: {
      id: 7,
      title: 'Coding Monthly',
      price_amount: 30,
      currency: 'CNY',
      duration_unit: 'month',
      duration_value: 1,
      quota_reset_period: 'never',
      enabled: true,
      sort_order: 10,
      allow_balance_pay: true,
      allow_wallet_overflow: true,
      max_purchase_per_user: 0,
      max_concurrency: 5,
      max_output_tokens: 32768,
      total_amount: 30,
      quota_windows: [],
      upgrade_group: '',
      downgrade_group: '',
      route_groups: ['codex-pro'],
      route_group_ratios: { 'codex-pro': ratio },
      route_group_cost_ratios: { 'codex-pro': 0 },
    },
  }
}

function renderDrawer(ratio: number) {
  return render(
    <I18nextProvider i18n={i18n}>
      <SubscriptionsMutateDrawer
        open
        onOpenChange={() => {}}
        currentRow={planRecord(ratio)}
      />
    </I18nextProvider>
  )
}

beforeEach(() => {
  mocks.getGroups.mockReset()
  mocks.updatePlan.mockReset()
  mocks.listProductOptions.mockReset()
  mocks.triggerRefresh.mockReset()
  mocks.toast.error.mockReset()
  mocks.toast.success.mockReset()
  mocks.getGroups.mockResolvedValue({
    success: true,
    data: ['codex-pro', 'kiro-cc'],
  })
  mocks.listProductOptions.mockResolvedValue({
    message: 'success',
    data: { products: [] },
  })
  mocks.updatePlan.mockResolvedValue({ success: true })
})

test('starts with inheritance disabled and saves an explicit plan multiplier', async () => {
  const user = userEvent.setup()
  renderDrawer(0.154)

  const inheritSwitch = await screen.findByRole('switch', {
    name: 'Inherit normal multiplier',
  })
  const ratioInput = screen.getByRole('spinbutton', {
    name: 'Plan multiplier for codex-pro',
  })

  expect(inheritSwitch).not.toBeChecked()
  expect(ratioInput).toBeEnabled()
  expect(ratioInput).toHaveValue(0.154)

  await user.click(inheritSwitch)
  expect(inheritSwitch).toBeChecked()
  expect(ratioInput).toBeDisabled()

  await user.click(inheritSwitch)
  expect(ratioInput).toBeEnabled()
  expect(ratioInput).toHaveValue(1)

  await user.clear(ratioInput)
  await user.type(ratioInput, '0.12')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))

  await waitFor(() => expect(mocks.updatePlan).toHaveBeenCalledOnce())
  expect(mocks.updatePlan).toHaveBeenCalledWith(
    7,
    expect.objectContaining({
      plan: expect.objectContaining({
        route_group_ratios: { 'codex-pro': 0.12 },
      }),
    })
  )
})

test('saves zero when the normal group multiplier is inherited', async () => {
  const user = userEvent.setup()
  renderDrawer(0)

  const inheritSwitch = await screen.findByRole('switch', {
    name: 'Inherit normal multiplier',
  })
  const ratioInput = screen.getByRole('spinbutton', {
    name: 'Plan multiplier for codex-pro',
  })

  expect(inheritSwitch).toBeChecked()
  expect(ratioInput).toBeDisabled()

  await user.click(screen.getByRole('button', { name: 'Save changes' }))

  await waitFor(() => expect(mocks.updatePlan).toHaveBeenCalledOnce())
  expect(mocks.updatePlan).toHaveBeenCalledWith(
    7,
    expect.objectContaining({
      plan: expect.objectContaining({
        route_group_ratios: { 'codex-pro': 0 },
      }),
    })
  )
})

test('saves a plan-specific upstream cost ratio', async () => {
  const user = userEvent.setup()
  renderDrawer(0.154)

  const costRatioInput = await screen.findByRole('spinbutton', {
    name: 'Upstream cost ratio for codex-pro',
  })

  expect(costRatioInput).toHaveValue(0)

  await user.clear(costRatioInput)
  await user.type(costRatioInput, '0.0735')
  expect(costRatioInput).toHaveValue(0.0735)
  await user.click(screen.getByRole('button', { name: 'Save changes' }))

  await waitFor(() => expect(mocks.updatePlan).toHaveBeenCalledOnce())
  expect(mocks.updatePlan).toHaveBeenCalledWith(
    7,
    expect.objectContaining({
      plan: expect.objectContaining({
        route_group_cost_ratios: { 'codex-pro': 0.0735 },
      }),
    })
  )
})
