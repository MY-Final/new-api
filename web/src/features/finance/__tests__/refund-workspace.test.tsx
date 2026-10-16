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
import { beforeEach, expect, test, vi } from 'vitest'

import { RefundWorkspace } from '../components/refund-workspace'
import type { RefundBatch, RequestBilling } from '../types'

const api = vi.hoisted(() => ({
  getRefundQueue: vi.fn(),
  createRefundBatch: vi.fn(),
  getRefundBatches: vi.fn(),
  retryRefundBatch: vi.fn(),
}))
vi.mock('../api', () => api)
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: React.ReactNode }) => (
    <a href='#'>{props.children}</a>
  ),
}))
vi.mock('@/features/users/api', () => ({
  getGroups: vi.fn(async () => []),
  searchUsers: vi.fn(async () => ({ success: true, data: { items: [] } })),
}))
const record: RequestBilling = {
  billing_id: 'charge-1',
  request_id: 'request-1',
  user_id: 7,
  username: 'Alice',
  model_name: 'model-a',
  channel_id: 17,
  funding_source: 'wallet',
  subscription_id: 0,
  quota: 1000000,
  bonus_quota: 600000,
  paid_quota: 400000,
  refunded_quota: 0,
  refunded_at: 0,
  refund_operation_id: 0,
  created_at: 1700000000,
  settled: true,
}
const batch: RefundBatch = {
  task_id: 'batch-1',
  status: 'failed',
  payload: {
    billing_ids: ['charge-1', 'charge-2'],
    reason: 'incident',
    operator_id: 1,
  },
  state: {
    total: 2,
    processed: 2,
    succeeded: 1,
    failed: 1,
    progress: 100,
    items: [
      {
        billing_id: 'charge-1',
        request_id: 'request-1',
        username: 'Alice',
        quota: 1000000,
        status: 'succeeded',
        already_refunded: false,
      },
      {
        billing_id: 'charge-2',
        request_id: 'request-2',
        username: 'Bob',
        quota: 1000000,
        status: 'failed',
        already_refunded: false,
        error: 'The subscription billing period has changed',
      },
    ],
  },
  created_at: 1700000000,
}
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RefundWorkspace />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  api.getRefundQueue.mockResolvedValue({
    items: [
      record,
      {
        ...record,
        billing_id: 'charge-2',
        request_id: 'request-2',
        username: 'Bob',
        user_id: 8,
        funding_source: 'subscription',
        bonus_quota: 0,
        paid_quota: 0,
      },
    ],
    total: 2,
  })
  api.getRefundBatches.mockResolvedValue({ items: [], total: 0 })
})
test('refund page keeps refund navigation without a duplicate financial operations shortcut', () => {
  show()
  expect(
    screen.getByRole('heading', { name: 'Refund center' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: /Consumption refunds/ })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: /Offline refund registration/ })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Financial operations' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Financial operations' })
  ).not.toBeInTheDocument()
})

test('filters are submitted to the server and changing them clears selected charges', async () => {
  const user = userEvent.setup()
  show()
  await user.click(
    await screen.findByRole('checkbox', { name: 'Select request-1' })
  )
  await user.type(screen.getByRole('textbox', { name: 'Model' }), 'model-a')
  await user.type(screen.getByRole('spinbutton', { name: 'Channel ID' }), '17')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() =>
    expect(api.getRefundQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ model_name: 'model-a', channel_id: 17 }),
      1,
      20
    )
  )
  expect(
    screen.getByRole('checkbox', { name: 'Select request-1' })
  ).not.toBeChecked()
})
test('preview shows each funding destination and confirmation creates a persistent batch', async () => {
  const user = userEvent.setup()
  api.createRefundBatch.mockResolvedValue({ ...batch, status: 'pending' })
  show()
  await screen.findByRole('checkbox', { name: 'Select request-1' })
  await user.click(
    screen.getByRole('checkbox', { name: 'Select refundable on this page' })
  )
  await user.click(screen.getByRole('button', { name: /Preview refund/ }))
  const confirmation = await screen.findByRole('alertdialog')
  expect(confirmation).toHaveClass('data-[size=default]:sm:max-w-3xl')
  expect(within(confirmation).getByText('Bonus quota')).toBeVisible()
  expect(within(confirmation).getByText('Paid quota')).toBeVisible()
  expect(within(confirmation).getByText('Subscription')).toBeVisible()
  const submit = within(confirmation).getByRole('button', {
    name: 'Create refund batch',
  })
  expect(submit).toBeDisabled()
  await user.type(
    within(confirmation).getByRole('textbox', { name: 'Refund reason' }),
    'Provider incident'
  )
  await user.click(submit)
  await waitFor(() =>
    expect(api.createRefundBatch).toHaveBeenCalledWith(
      ['charge-1', 'charge-2'],
      'Provider incident',
      expect.any(String)
    )
  )
})
test('persisted batches show item errors and offer a server-side retry of unfinished items', async () => {
  const user = userEvent.setup()
  api.getRefundBatches.mockResolvedValue({ items: [batch], total: 1 })
  api.retryRefundBatch.mockResolvedValue({
    ...batch,
    task_id: 'batch-2',
    status: 'pending',
  })
  show()
  await user.click(screen.getByRole('tab', { name: 'Refund batches' }))
  await user.click(await screen.findByRole('button', { name: 'View results' }))
  expect(
    screen.getByText('The subscription billing period has changed')
  ).toBeVisible()
  await user.click(
    screen.getByRole('button', { name: 'Retry unfinished items' })
  )
  await waitFor(() =>
    expect(api.retryRefundBatch).toHaveBeenCalledWith(
      'batch-1',
      expect.any(String)
    )
  )
})

test('pending and blocked charges cannot be selected for a refund', async () => {
  api.getRefundQueue.mockResolvedValue({
    items: [
      {
        ...record,
        settled: false,
        blocked_reason: 'This request has not finished billing yet',
      },
      {
        ...record,
        billing_id: 'expired',
        request_id: 'expired-request',
        blocked_reason: 'The subscription billing period has changed',
      },
    ],
    total: 2,
  })
  show()
  expect(
    await screen.findByRole('checkbox', { name: 'Select request-1' })
  ).toHaveAttribute('aria-disabled', 'true')
  expect(
    screen.getByRole('checkbox', { name: 'Select expired-request' })
  ).toHaveAttribute('aria-disabled', 'true')
  expect(
    screen.getByRole('checkbox', { name: 'Select refundable on this page' })
  ).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('button', { name: /Preview refund/ })).toBeDisabled()
  expect(
    screen.getByText('The subscription billing period has changed')
  ).toBeVisible()
})

test('queue errors offer a retry and empty results explain historical billing limits', async () => {
  const user = userEvent.setup()
  api.getRefundQueue
    .mockRejectedValueOnce(new Error('Queue unavailable'))
    .mockResolvedValue({ items: [], total: 0 })
  show()
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No matching request charges')).toBeVisible()
  expect(
    screen.getByText(
      'Adjust the filters. Historical requests without billing snapshots are unavailable.'
    )
  ).toBeVisible()
})

test('a failed submission retries the same batch identifier and payload', async () => {
  const user = userEvent.setup()
  api.createRefundBatch
    .mockRejectedValueOnce(new Error('Network interrupted'))
    .mockResolvedValue({ ...batch, status: 'pending' })
  show()
  await user.click(
    await screen.findByRole('checkbox', { name: 'Select request-1' })
  )
  await user.click(screen.getByRole('button', { name: /Preview refund/ }))
  const dialog = await screen.findByRole('alertdialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Refund reason' }),
    'Outage'
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Create refund batch' })
  )
  await screen.findByText('Retry to check the same submission safely.', {
    exact: false,
  })
  await user.click(
    within(dialog).getByRole('button', { name: 'Create refund batch' })
  )
  await waitFor(() => expect(api.createRefundBatch).toHaveBeenCalledTimes(2))
  expect(api.createRefundBatch.mock.calls[1]).toEqual(
    api.createRefundBatch.mock.calls[0]
  )
})

test('selection survives pagination and stops at the batch limit', async () => {
  const user = userEvent.setup()
  api.getRefundQueue.mockImplementation(async (_filters, page: number) => ({
    items: Array.from({ length: 20 }, (_, offset) => ({
      ...record,
      billing_id: `charge-${(page - 1) * 20 + offset + 1}`,
      request_id: `request-${(page - 1) * 20 + offset + 1}`,
    })),
    total: 220,
  }))
  show()
  await screen.findByRole('checkbox', { name: 'Select request-1' })
  for (let page = 1; page <= 10; page++) {
    await user.click(
      screen.getByRole('checkbox', { name: 'Select refundable on this page' })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `Preview refund (${page * 20})` })
      ).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await screen.findByRole('checkbox', {
      name: `Select request-${page * 20 + 1}`,
    })
  }
  expect(
    screen.getByRole('checkbox', { name: 'Select request-201' })
  ).toHaveAttribute('aria-disabled', 'true')
  expect(
    screen.getByRole('checkbox', { name: 'Select refundable on this page' })
  ).toHaveAttribute('aria-disabled', 'true')
  await user.click(screen.getByRole('button', { name: 'Go to first page' }))
  expect(
    await screen.findByRole('checkbox', { name: 'Select request-1' })
  ).toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: 'Select request-1' }))
  expect(
    screen.getByRole('button', { name: 'Preview refund (199)' })
  ).toBeEnabled()
})

test('a total outside safe integer precision cannot be submitted', async () => {
  const user = userEvent.setup()
  api.getRefundQueue.mockResolvedValue({
    items: [
      record,
      {
        ...record,
        billing_id: 'large-charge',
        request_id: 'large-request',
        quota: Number.MAX_SAFE_INTEGER,
        bonus_quota: Number.MAX_SAFE_INTEGER,
        paid_quota: 0,
      },
    ],
    total: 2,
  })
  show()
  await screen.findByRole('checkbox', { name: 'Select request-1' })
  await user.click(
    screen.getByRole('checkbox', { name: 'Select refundable on this page' })
  )
  await user.click(screen.getByRole('button', { name: /Preview refund/ }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'The total is too large. Select fewer requests.'
  )
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Refund reason' }),
    'Correction'
  )
  expect(
    within(dialog).getByRole('button', { name: 'Create refund batch' })
  ).toBeDisabled()
  expect(api.createRefundBatch).not.toHaveBeenCalled()
})

test('mobile filters open separately and return to selectable request cards after applying', async () => {
  const original = window.matchMedia
  const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query === '(max-width: 640px)',
  }))
  try {
    const user = userEvent.setup()
    show()
    await screen.findByRole('checkbox', { name: 'Select request-1' })
    expect(
      screen.queryByRole('textbox', { name: 'Model' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    const dialog = await screen.findByRole('dialog', { name: 'Filter' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Model' }),
      'model-a'
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Apply filters' })
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(api.getRefundQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ model_name: 'model-a' }),
        1,
        20
      )
    )
    await user.click(screen.getByRole('checkbox', { name: 'Select request-1' }))
    expect(
      screen.getByRole('button', { name: 'Preview refund (1)' })
    ).toBeEnabled()
  } finally {
    media.mockRestore()
  }
})

test('applied model filters remain visible after returning from batch history', async () => {
  const user = userEvent.setup()
  show()
  await screen.findByRole('checkbox', { name: 'Select request-1' })
  await user.type(screen.getByRole('textbox', { name: 'Model' }), 'model-a')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() =>
    expect(api.getRefundQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ model_name: 'model-a' }),
      1,
      20
    )
  )
  await user.click(screen.getByRole('tab', { name: 'Refund batches' }))
  expect(
    screen.queryByRole('textbox', { name: 'Model' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Request charges' }))
  expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('model-a')
})
