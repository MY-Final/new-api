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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { ManualCreditForm } from '../components/manual-credit-form'

const api = vi.hoisted(() => ({ createManualCredit: vi.fn() }))
const users = vi.hoisted(() => ({ searchUsers: vi.fn(), getUser: vi.fn() }))
vi.mock('../api', () => api)
vi.mock('@/features/users/api', () => users)

const alice = {
  id: 7,
  username: 'alice',
  display_name: 'Alice',
  quota: 500000,
  paid_quota: 300000,
  bonus_quota: 200000,
}
const bob = { ...alice, id: 8, username: 'bob', display_name: 'Bob' }
const initialConfig = useSystemConfigStore.getState().config
afterEach(() => useSystemConfigStore.getState().setConfig(initialConfig))

beforeEach(() => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
  })
  users.searchUsers.mockResolvedValue({
    success: true,
    data: { items: [alice, bob] },
  })
  users.getUser.mockImplementation(async (id: number) => ({
    success: true,
    data: id === 7 ? alice : bob,
  }))
  api.createManualCredit.mockResolvedValue({ operation: { id: 11 } })
})

function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <ManualCreditForm />
    </QueryClientProvider>
  )
}

async function selectAlice() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'User' }))
  await user.click(await screen.findByRole('option', { name: /Alice.*#7/ }))
  await waitFor(() => expect(users.getUser).toHaveBeenCalledWith(7))
  return user
}

test('paid credit requires a payment reference and receipt confirmation before submission', async () => {
  show()
  const user = await selectAlice()
  await user.type(screen.getByRole('spinbutton', { name: /Paid credit/ }), '50')
  await user.type(
    screen.getByRole('spinbutton', { name: /Promotional credit/ }),
    '10'
  )
  await user.type(
    screen.getByRole('textbox', { name: /Reason/ }),
    'Offline payment with promotion'
  )
  await user.click(screen.getByRole('button', { name: 'Review credit' }))
  expect(
    await screen.findByText('Payment reference is required for paid credit')
  ).toBeVisible()
  expect(api.createManualCredit).not.toHaveBeenCalled()
  await user.type(
    screen.getByRole('textbox', { name: /Payment reference/ }),
    'wechat-50'
  )
  await user.click(screen.getByRole('button', { name: 'Review credit' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(
    within(dialog).getByRole('button', { name: 'Confirm credit' })
  ).toBeDisabled()
  await user.click(
    within(dialog).getByRole('checkbox', {
      name: 'I confirm the offline payment has been received',
    })
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm credit' })
  )
  await waitFor(() =>
    expect(api.createManualCredit.mock.calls[0]?.[0]).toMatchObject({
      user_id: 7,
      paid_quota: 25000000,
      bonus_quota: 5000000,
      reference: 'wechat-50',
      payment_received: true,
    })
  )
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(screen.getByRole('spinbutton', { name: /Paid credit/ })).toHaveValue(
    null
  )
})

test('gift-only credit needs no payment receipt and retries the same operation after a network failure', async () => {
  api.createManualCredit.mockRejectedValueOnce(new Error('Network unavailable'))
  show()
  const user = await selectAlice()
  await user.type(
    screen.getByRole('spinbutton', { name: /Promotional credit/ }),
    '5'
  )
  await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'Trial gift')
  await user.click(screen.getByRole('button', { name: 'Review credit' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm credit' })
  )
  await waitFor(() => expect(api.createManualCredit).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: 'Confirm credit' })
    ).toBeEnabled()
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm credit' })
  )
  await waitFor(() => expect(api.createManualCredit).toHaveBeenCalledTimes(2))
  expect(api.createManualCredit.mock.calls[0][0]).toEqual(
    api.createManualCredit.mock.calls[1][0]
  )
  expect(api.createManualCredit.mock.calls[0][0]).toMatchObject({
    paid_quota: 0,
    bonus_quota: 2500000,
    reference: '',
    payment_received: false,
  })
})

test('no recipient, negative amounts and unsafe totals cannot be submitted', async () => {
  show()
  expect(screen.getByRole('button', { name: 'Review credit' })).toBeDisabled()
  const user = await selectAlice()
  const amount = screen.getByRole('spinbutton', { name: /Paid credit/ })
  await user.type(amount, '-10')
  expect(screen.getByRole('button', { name: 'Review credit' })).toBeDisabled()
  await user.clear(amount)
  await user.type(amount, '99999999999999999')
  expect(screen.getByRole('button', { name: 'Review credit' })).toBeDisabled()
  expect(api.createManualCredit).not.toHaveBeenCalled()
})

test('failed user lookup keeps submission disabled and exposes a retry', async () => {
  users.getUser.mockRejectedValue(new Error('User lookup failed'))
  show()
  const user = await selectAlice()
  await user.type(
    screen.getByRole('spinbutton', { name: /Promotional credit/ }),
    '5'
  )
  expect(await screen.findByRole('button', { name: /Retry/i })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Review credit' })).toBeDisabled()
})

test('editing the recipient search clears the previous recipient before credit can be reviewed', async () => {
  show()
  const user = await selectAlice()
  await user.type(
    screen.getByRole('spinbutton', { name: /Promotional credit/ }),
    '5'
  )
  await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'Trial gift')
  expect(screen.getByRole('button', { name: 'Review credit' })).toBeEnabled()
  await user.type(screen.getByRole('combobox', { name: 'User' }), 'bob')
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Review credit' })).toBeDisabled()
  expect(api.createManualCredit).not.toHaveBeenCalled()
})
