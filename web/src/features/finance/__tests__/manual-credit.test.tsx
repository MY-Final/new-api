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
import { ManualCreditWorkspace } from '../components/manual-credit-workspace'

const api = vi.hoisted(() => ({
  createManualCredit: vi.fn(),
  getFinancialOperations: vi.fn(),
}))
const users = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  getUser: vi.fn(),
  getGroups: vi.fn(async () => []),
}))
vi.mock('../api', () => api)
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: React.ReactNode }) => (
    <a href='#'>{props.children}</a>
  ),
}))
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

function show(workspace = false) {
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
      {workspace ? <ManualCreditWorkspace /> : <ManualCreditForm />}
    </QueryClientProvider>
  )
}

async function selectAlice(withPaymentChannel = true) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'User' }))
  await user.click(await screen.findByRole('option', { name: /Alice.*#7/ }))
  await waitFor(() => expect(users.getUser).toHaveBeenCalledWith(7))
  if (withPaymentChannel) {
    await user.click(screen.getByRole('combobox', { name: /Payment channel/ }))
    await user.click(await screen.findByRole('option', { name: 'WeChat Pay' }))
  }
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
      paymentChannel: 'wechat',
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

test('payment channel is required before a credit can be reviewed', async () => {
  show()
  const user = await selectAlice(false)
  await user.type(
    screen.getByRole('spinbutton', { name: /Promotional credit/ }),
    '5'
  )
  await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'Trial gift')
  const channel = screen.getByRole('combobox', { name: /Payment channel/ })
  expect(channel).toHaveAttribute('aria-required', 'true')
  await user.click(channel)
  expect(screen.getByRole('button', { name: 'Review credit' })).toBeDisabled()
  expect(api.createManualCredit).not.toHaveBeenCalled()
  for (const name of [
    'WeChat Pay',
    'Alipay',
    'Bank transfer',
    'USDT',
    'Other',
  ]) {
    expect(screen.getByRole('option', { name })).toBeInTheDocument()
  }
  await user.click(screen.getByRole('option', { name: 'Other' }))
  expect(channel).toHaveTextContent('Other')
  channel.focus()
  await user.keyboard('{ArrowDown}')
  expect(await screen.findByRole('listbox')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(channel).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Review credit' }))
  expect(channel).toBeDisabled()
  expect(
    within(await screen.findByRole('alertdialog')).getByText(
      'Payment channel: Other'
    )
  ).toBeVisible()
})

test('recent credits show payment badges between reference and reason with an empty legacy fallback', async () => {
  api.getFinancialOperations.mockResolvedValue({
    items: [
      {
        id: 11,
        source_id: 'wx-receipt',
        payment_channel: 'wechat',
        reason: 'Offline payment',
        target_paid_delta: 500000,
        target_bonus_delta: 0,
        created_at: 1700000000,
      },
      {
        id: 12,
        source_id: 'alipay-receipt',
        payment_channel: 'alipay',
        reason: 'Offline payment',
        target_paid_delta: 500000,
        target_bonus_delta: 0,
        created_at: 1700000000,
      },
      {
        id: 13,
        source_id: 'legacy-receipt',
        reason: 'Legacy payment',
        target_paid_delta: 500000,
        target_bonus_delta: 0,
        created_at: 1700000000,
      },
    ],
    total: 3,
  })
  show(true)
  const table = await screen.findByRole('table')
  await within(table).findByText('wx-receipt')
  const headers = within(table)
    .getAllByRole('columnheader')
    .map((header) => header.textContent)
  const reference = headers.indexOf('Payment reference')
  expect(headers.slice(reference, reference + 3)).toEqual([
    'Payment reference',
    'Payment channel',
    'Reason',
  ])
  const wechat = within(table).getByText('WeChat Pay')
  const alipay = within(table).getByText('Alipay')
  expect(wechat.closest('[data-slot="status-badge"]')).toHaveAttribute(
    'title',
    'WeChat Pay'
  )
  expect(alipay.closest('[data-slot="status-badge"]')).toHaveAttribute(
    'title',
    'Alipay'
  )
  expect(
    within(
      within(table).getByRole('row', { name: /legacy-receipt/ })
    ).getByText('—')
  ).toBeVisible()
})

test('credit history searches all manual credits and retains its scope through pagination and clearing filters', async () => {
  api.getFinancialOperations.mockResolvedValue({ items: [], total: 21 })
  const user = userEvent.setup()
  show(true)
  await waitFor(() =>
    expect(api.getFinancialOperations).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      operationType: 'manual_credit',
    })
  )
  await user.click(screen.getByRole('tab', { name: 'Credit history' }))
  await waitFor(() =>
    expect(api.getFinancialOperations).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      operationType: 'manual_credit',
    })
  )
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(api.getFinancialOperations).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 })
    )
  )
  await user.type(
    screen.getByRole('textbox', {
      name: 'Payment reference or username (exact match)',
    }),
    'old-receipt'
  )
  await waitFor(() =>
    expect(api.getFinancialOperations).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      operationType: 'manual_credit',
      keyword: 'old-receipt',
    })
  )
  const history = screen.getByRole('tabpanel', { name: 'Credit history' })
  await user.click(within(history).getByRole('combobox', { name: 'User' }))
  await user.click(await screen.findByRole('option', { name: /Alice.*#7/ }))
  await user.type(
    within(history).getByRole('spinbutton', { name: 'Operator ID' }),
    '3'
  )
  await waitFor(() =>
    expect(api.getFinancialOperations).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: 7,
        operatorId: '3',
        keyword: 'old-receipt',
        operationType: 'manual_credit',
        page: 1,
      })
    )
  )
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  await waitFor(() =>
    expect(api.getFinancialOperations).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      operationType: 'manual_credit',
    })
  )
  expect(within(history).getByRole('textbox')).toHaveValue('')
  await user.click(screen.getByRole('tab', { name: 'Recent manual credits' }))
  expect(
    screen.queryByRole('textbox', {
      name: 'Payment reference or username (exact match)',
    })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('spinbutton', { name: /Paid credit/ })).toBeVisible()
})

test('history shortcut opens searchable records while a query failure keeps filters and retry available', async () => {
  api.getFinancialOperations.mockResolvedValue({ items: [], total: 0 })
  const user = userEvent.setup()
  show(true)
  await screen.findByText('No financial records found')
  await user.click(screen.getByRole('button', { name: 'Credit history' }))
  expect(screen.getByRole('tab', { name: 'Credit history' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  api.getFinancialOperations.mockRejectedValue(new Error('History unavailable'))
  const search = screen.getByRole('textbox', {
    name: 'Payment reference or username (exact match)',
  })
  await user.type(search, 'missing-receipt')
  await screen.findByRole('button', { name: /Retry/ })
  expect(search).toHaveValue('missing-receipt')
  api.getFinancialOperations.mockResolvedValue({ items: [], total: 0 })
  await user.click(screen.getByRole('button', { name: /Retry/ }))
  await screen.findByText('No financial records found')
  expect(search).toHaveValue('missing-receipt')
})

test('history preserves the selected date range and credit draft when switching views', async () => {
  api.getFinancialOperations.mockResolvedValue({ items: [], total: 0 })
  const user = userEvent.setup()
  show(true)
  const amount = screen.getByRole('spinbutton', { name: /Paid credit/ })
  await user.type(amount, '50')
  await user.click(screen.getByRole('tab', { name: 'Credit history' }))
  await user.click(screen.getByRole('button', { name: 'Date Range' }))
  await user.click(screen.getByRole('button', { name: '7 Days' }))
  await waitFor(() =>
    expect(api.getFinancialOperations).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operationType: 'manual_credit',
        startTime: expect.any(Number),
        endTime: expect.any(Number),
      })
    )
  )
  const query = api.getFinancialOperations.mock.calls.at(-1)?.[0]
  await user.click(screen.getByRole('tab', { name: 'Recent manual credits' }))
  await user.click(screen.getByRole('tab', { name: 'Credit history' }))
  expect(
    screen.queryByRole('button', { name: 'Date Range' })
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(api.getFinancialOperations).toHaveBeenLastCalledWith(query)
  )
  expect(amount).toHaveValue(50)
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.getByRole('button', { name: 'Date Range' })).toBeVisible()
})
