import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import type { SubscriptionCycleTokenUsage } from '../../../types'
import { SubscriptionCycleUsageDialog } from '../subscription-cycle-usage-dialog'
import { UserSubscriptionsDialog } from '../user-subscriptions-dialog'

const periods: SubscriptionCycleTokenUsage[] = [
  {
    subscription_id: 42,
    plan_id: 7,
    plan_title: 'Monthly',
    order_id: 2,
    cycle: 2,
    start_time: 1_730_000_000,
    end_time: 1_732_000_000,
    request_count: 15,
    input_tokens: 1200,
    output_tokens: 300,
    cache_read_tokens: 400,
    cache_write_tokens: 100,
    total_tokens: 1500,
  },
  {
    subscription_id: 42,
    plan_id: 7,
    plan_title: 'Monthly',
    order_id: 1,
    cycle: 1,
    start_time: 1_728_000_000,
    end_time: 1_730_000_000,
    request_count: 6,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 20,
    cache_write_tokens: 10,
    total_tokens: 150,
  },
]

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
})

function Wrapper(props: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  )
}

it('loads only after opening and displays separate purchase periods with token details', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: periods },
  })
  const view = render(
    <SubscriptionCycleUsageDialog
      open={false}
      onOpenChange={vi.fn()}
      user={{ id: 12, username: 'Alice' }}
    />,
    { wrapper: Wrapper }
  )
  expect(get).not.toHaveBeenCalled()

  view.rerender(
    <SubscriptionCycleUsageDialog
      open
      onOpenChange={vi.fn()}
      user={{ id: 12, username: 'Alice' }}
    />
  )
  const table = await screen.findByRole('table')
  expect(get).toHaveBeenCalledWith(
    '/api/subscription/admin/users/12/subscriptions/usage'
  )
  const rows = within(table).getAllByRole('row')
  expect(rows).toHaveLength(3)
  expect(rows[1]).toHaveTextContent('Cycle 2')
  expect(rows[2]).toHaveTextContent('Cycle 1')
  for (const amount of ['15', '1,200', '300', '400', '100', '1,500']) {
    expect(within(rows[1]).getByText(amount, { exact: true })).toBeVisible()
  }
  expect(
    screen.getByText(
      'Only retained subscription consumption logs are counted. Wallet requests are excluded; cleared logs cannot be recovered.'
    )
  ).toBeVisible()
})

it('provides retry after a failure and shows an empty result after recovery', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue({ data: { success: true, data: [] } })
  render(
    <SubscriptionCycleUsageDialog
      open
      onOpenChange={vi.fn()}
      user={{ id: 12 }}
    />,
    { wrapper: Wrapper }
  )
  expect(await screen.findByText('Failed to load usage details')).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No subscription records')).toBeVisible()
  expect(get).toHaveBeenCalledTimes(2)
})

it('clears the previous user statistics when the selected user changes', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: { success: true, data: url.includes('/12/') ? periods : [] },
  }))
  const view = render(
    <SubscriptionCycleUsageDialog
      open
      onOpenChange={vi.fn()}
      user={{ id: 12, username: 'Alice' }}
    />,
    { wrapper: Wrapper }
  )
  expect(await screen.findByText('Cycle 2', { exact: false })).toBeVisible()
  view.rerender(
    <SubscriptionCycleUsageDialog
      open
      onOpenChange={vi.fn()}
      user={{ id: 13, username: 'Bob' }}
    />
  )
  expect(await screen.findByText('No subscription records')).toBeVisible()
  expect(
    screen.queryByText('Cycle 2', { exact: false })
  ).not.toBeInTheDocument()
})

it('opens cycle usage from administrator subscription management on demand', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/usage') ? periods : [],
    },
  }))
  render(
    <UserSubscriptionsDialog
      open
      onOpenChange={vi.fn()}
      user={{ id: 12, username: 'Alice' }}
    />,
    { wrapper: Wrapper }
  )
  const trigger = screen.getByRole('button', {
    name: 'Subscription cycle usage',
  })
  await waitFor(() => expect(trigger).toBeEnabled())
  expect(
    get.mock.calls.some(([url]) => url.endsWith('/subscriptions/usage'))
  ).toBe(false)
  await userEvent.setup().click(trigger)
  expect(
    await screen.findByRole('dialog', { name: 'Subscription cycle usage' })
  ).toBeVisible()
  expect(await screen.findByText('Cycle 2', { exact: false })).toBeVisible()
})
