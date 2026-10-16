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
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, expect, test, vi } from 'vitest'

import { RequestRefundDialog } from '../components/request-refund-dialog'
import type { RequestBilling } from '../types'

const getRequestBillings = vi.hoisted(() => vi.fn())
const getUserRequestBillings = vi.hoisted(() => vi.fn())
const refundRequestBilling = vi.hoisted(() => vi.fn())
const searchUsers = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({
  getRequestBillings,
  getUserRequestBillings,
  refundRequestBilling,
}))
vi.mock('@/features/users/api', () => ({ searchUsers }))
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
const record: RequestBilling = {
  billing_id: 'billing-1',
  request_id: 'request-1',
  user_id: 7,
  username: 'alice',
  model_name: 'test-model',
  funding_source: 'wallet',
  subscription_id: 0,
  quota: 120,
  bonus_quota: 100,
  paid_quota: 20,
  refunded_quota: 0,
  refunded_at: 0,
  refund_operation_id: 0,
  created_at: 1700000000,
  settled: true,
}
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const onClose = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RequestRefundDialog requestId='request-1' onClose={onClose} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return onClose
}
beforeEach(() => {
  getRequestBillings.mockReset()
  getUserRequestBillings.mockReset()
  refundRequestBilling.mockReset()
  searchUsers.mockReset()
})
test('unfinished requests show pending status and disable refunds', async () => {
  getRequestBillings.mockResolvedValue([
    {
      ...record,
      settled: false,
      blocked_reason: 'This request has not finished settlement',
    },
  ])
  show()
  expect(await screen.findByText('Pending')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Refund full amount' })
  ).toBeDisabled()
})
test('lookup failure preserves the server error and retry recovers', async () => {
  getRequestBillings
    .mockRejectedValueOnce(new Error('Database unavailable'))
    .mockResolvedValueOnce([record])
  const user = userEvent.setup()
  show()
  expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByRole('button', { name: 'Refund full amount' })
  ).toBeEnabled()
})
test('full refund requires a reason, locks while pending and then shows refunded', async () => {
  getRequestBillings.mockResolvedValue([record])
  let finish: ((value: unknown) => void) | undefined
  refundRequestBilling.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const user = userEvent.setup()
  const onClose = show()
  await user.click(
    await screen.findByRole('button', { name: 'Refund full amount' })
  )
  const confirmation = screen.getByRole('alertdialog')
  const confirm = within(confirmation).getByRole('button', {
    name: 'Refund full amount',
  })
  expect(confirm).toBeDisabled()
  await user.type(
    within(confirmation).getByRole('textbox', { name: 'Refund reason' }),
    'Upstream failed'
  )
  await user.click(confirm)
  await waitFor(() =>
    expect(refundRequestBilling).toHaveBeenCalledWith(
      'billing-1',
      'Upstream failed'
    )
  )
  expect(confirm).toBeDisabled()
  expect(
    within(confirmation).getByRole('button', { name: 'Cancel' })
  ).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(onClose).not.toHaveBeenCalled()
  getRequestBillings.mockResolvedValue([
    { ...record, refunded_quota: 120, refund_operation_id: 44 },
  ])
  finish?.({ already_refunded: false })
  expect(await screen.findByText('Refunded')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Refund full amount' })
  ).not.toBeInTheDocument()
})

test('empty lookup displays an empty state', async () => {
  getRequestBillings.mockResolvedValue([])
  show()
  expect(
    await screen.findByText(
      'No refundable billing record was found for this request'
    )
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Refund full amount' })
  ).not.toBeInTheDocument()
})

test('multiple charges keep long identifiers readable and cancellation performs no refund', async () => {
  getRequestBillings.mockResolvedValue([
    record,
    {
      ...record,
      billing_id: 'billing-2',
      model_name: 'model-name-that-is-long-enough-to-wrap-on-small-screens',
    },
  ])
  const user = userEvent.setup()
  show()
  const buttons = await screen.findAllByRole('button', {
    name: 'Refund full amount',
  })
  expect(buttons).toHaveLength(2)
  const name = screen.getByText(/model-name-that-is-long/)
  expect(name).toHaveClass('break-all')
  await user.click(buttons[1])
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel',
    })
  )
  expect(refundRequestBilling).not.toHaveBeenCalled()
  expect(
    await screen.findAllByRole('button', { name: 'Refund full amount' })
  ).toHaveLength(2)
})

test('user lookup allows selecting and refunding multiple requests in one confirmation', async () => {
  getRequestBillings.mockResolvedValue([])
  searchUsers.mockResolvedValue({
    success: true,
    data: { items: [{ id: 7, username: 'alice', display_name: 'Alice' }] },
  })
  getUserRequestBillings.mockResolvedValue({
    items: [
      record,
      { ...record, billing_id: 'billing-2', request_id: 'request-2' },
    ],
    total: 2,
    page: 1,
    page_size: 20,
  })
  refundRequestBilling.mockResolvedValue({ already_refunded: false })
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: 'By user' }))
  await user.type(screen.getByRole('combobox', { name: 'User' }), 'alice')
  await user.click(await screen.findByRole('option', { name: /alice/ }))
  const checkboxes = await screen.findAllByRole('checkbox')
  expect(checkboxes).toHaveLength(3)
  await user.click(checkboxes[1])
  await user.click(checkboxes[2])
  await user.click(screen.getByRole('button', { name: 'Refund selected (2)' }))
  const confirmation = screen.getByRole('alertdialog')
  await user.type(
    within(confirmation).getByRole('textbox', { name: 'Refund reason' }),
    'User requested correction'
  )
  await user.click(
    within(confirmation).getByRole('button', { name: 'Refund selected' })
  )
  await waitFor(() => expect(refundRequestBilling).toHaveBeenCalledTimes(2))
  expect(refundRequestBilling).toHaveBeenNthCalledWith(
    1,
    'billing-1',
    'User requested correction'
  )
  expect(refundRequestBilling).toHaveBeenNthCalledWith(
    2,
    'billing-2',
    'User requested correction'
  )
})

test('server user matches remain selectable when the search term is not part of the displayed name', async () => {
  getRequestBillings.mockResolvedValue([])
  searchUsers.mockResolvedValue({
    success: true,
    data: { items: [{ id: 7, username: 'alice', display_name: 'Alice' }] },
  })
  getUserRequestBillings.mockResolvedValue({ items: [record], total: 1 })
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: 'By user' }))
  await user.type(
    screen.getByRole('combobox', { name: 'User' }),
    'alice@example.com'
  )
  await waitFor(() =>
    expect(searchUsers).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'alice@example.com' })
    )
  )
  await user.click(await screen.findByRole('option', { name: /@alice/ }))
  expect(
    await screen.findByRole('checkbox', { name: 'Select request-1' })
  ).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'User' })).toHaveValue(
    'Alice (@alice) · User ID: 7'
  )
})

test('user search shows loading and an explicit empty result instead of hiding its popup', async () => {
  getRequestBillings.mockResolvedValue([])
  let finish: ((value: unknown) => void) | undefined
  searchUsers.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: 'By user' }))
  await user.type(screen.getByRole('combobox', { name: 'User' }), 'missing')
  expect(await screen.findByText('Loading...')).toBeVisible()
  await waitFor(() =>
    expect(searchUsers).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'missing' })
    )
  )
  finish?.({ success: true, data: { items: [] } })
  expect(await screen.findByText('No users found')).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'User' })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
})

test('changing users clears the previous request selection and keyboard selection loads the new user', async () => {
  getRequestBillings.mockResolvedValue([])
  searchUsers.mockImplementation(async ({ keyword }: { keyword: string }) => ({
    success: true,
    data: {
      items:
        keyword === 'bob'
          ? [{ id: 8, username: 'bob', display_name: 'Bob' }]
          : [{ id: 7, username: 'alice', display_name: 'Alice' }],
    },
  }))
  getUserRequestBillings.mockImplementation(async (id: number) => ({
    items:
      id === 7
        ? [record]
        : [
            {
              ...record,
              billing_id: 'billing-2',
              request_id: 'request-2',
              user_id: 8,
              username: 'bob',
            },
          ],
    total: 1,
  }))
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: 'By user' }))
  const input = screen.getByRole('combobox', { name: 'User' })
  await user.click(input)
  await user.click(await screen.findByRole('option', { name: /@alice/ }))
  await user.click(
    await screen.findByRole('checkbox', { name: 'Select request-1' })
  )
  expect(
    screen.getByRole('button', { name: 'Refund selected (1)' })
  ).toBeVisible()

  await user.click(input)
  await user.type(input, 'bob')
  await screen.findByRole('option', { name: /@bob/ })
  await user.keyboard('{ArrowDown}{Enter}')
  expect(
    await screen.findByRole('checkbox', { name: 'Select request-2' })
  ).not.toBeChecked()
  expect(
    screen.queryByRole('checkbox', { name: 'Select request-1' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Refund selected/ })
  ).not.toBeInTheDocument()
  expect(input).toHaveValue('Bob (@bob) · User ID: 8')
})

test('user search failure shows its error and retry makes the returned user selectable', async () => {
  getRequestBillings.mockResolvedValue([])
  searchUsers
    .mockRejectedValueOnce(new Error('User search unavailable'))
    .mockResolvedValue({
      success: true,
      data: { items: [{ id: 7, username: 'alice', display_name: 'Alice' }] },
    })
  getUserRequestBillings.mockResolvedValue({ items: [record], total: 1 })
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: 'By user' }))
  expect(await screen.findByText('User search unavailable')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await user.click(screen.getByRole('combobox', { name: 'User' }))
  await user.click(await screen.findByRole('option', { name: /@alice/ }))
  expect(
    await screen.findByRole('checkbox', { name: 'Select request-1' })
  ).toBeVisible()
  expect(screen.queryByText('User search unavailable')).not.toBeInTheDocument()
})

test('unselected search text survives blur and reopening the results', async () => {
  getRequestBillings.mockResolvedValue([])
  searchUsers.mockResolvedValue({ success: true, data: { items: [] } })
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: 'By user' }))
  const input = screen.getByRole('combobox', { name: 'User' })
  await user.type(input, 'missing')
  expect(await screen.findByText('No users found')).toBeVisible()
  await user.keyboard('{Escape}{Tab}')
  expect(input).toHaveValue('missing')
  await user.click(input)
  expect(await screen.findByText('No users found')).toBeVisible()
  expect(input).toHaveValue('missing')
})
