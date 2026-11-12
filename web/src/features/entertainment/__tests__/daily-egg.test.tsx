import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { Entertainment } from '..'

const status = {
  enabled: true,
  day: '2026-11-07',
  min_spend_cny: 2.5,
  spend_cny: 2.5,
  egg_count: 3,
  prizes: [
    {
      id: 'first',
      name: 'First prize',
      quota: 100,
      quantity: 5,
      probability: 2500,
    },
  ],
  eligible: true,
  free_draw_limit: 1,
  free_draw_used: 0,
  free_draw_remaining: 1,
  draw: null,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Entertainment />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

it('displays daily spending in the configured currency', async () => {
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      usdExchangeRate: 5,
      customCurrencyExchangeRate: 2,
    },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { ...status, spend_cny: 1 } },
  })
  renderPage()
  expect(await screen.findByText(/Daily spending:/)).toHaveTextContent(
    '🥚 0.4 / 🥚 1'
  )
})

it('shows configured eggs and prizes but prevents a draw below the spending threshold', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { ...status, eligible: false, spend_cny: 1 } },
  })
  renderPage()

  expect(await screen.findByRole('button', { name: 'Egg 1' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Egg 3' })).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'Egg 4' })
  ).not.toBeInTheDocument()
  expect(screen.getByText('First prize')).toBeVisible()
  expect(screen.getByText('25%')).toBeVisible()
  expect(
    screen.getByText('Reach the daily minimum spend to open an egg.')
  ).toBeVisible()
})

it('keeps the prize card compact when there is no draw result', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: status },
  })
  renderPage()

  const prizeCard = (await screen.findByText('Prize pool')).closest(
    '[data-slot="card"]'
  )
  expect(prizeCard?.parentElement).toHaveClass('lg:items-start')
  expect(
    screen.getByRole('group', { name: 'Choose an egg' }).nextElementSibling
  ).not.toHaveClass('mt-8')
})

it('shows the server result and prevents another draw', async () => {
  const result = {
    day: status.day,
    egg: 2,
    prize_name: 'First prize',
    quota: 100,
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { ...status, draw: result } },
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: result },
  })
  vi.mocked(api.get).mockResolvedValueOnce({
    data: { success: true, data: status },
  })
  renderPage()

  await userEvent.click(await screen.findByRole('button', { name: 'Egg 2' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/daily_egg', { egg: 2 })
  )
  expect(await screen.findByText('Come back tomorrow')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Egg 1' })).toBeDisabled()
})

it('shows the remaining free draw count and clears it after drawing', async () => {
  const result = {
    day: status.day,
    egg: 1,
    prize_name: 'First prize',
    quota: 100,
  }
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: true, data: status },
    })
    .mockResolvedValue({
      data: {
        success: true,
        data: {
          ...status,
          free_draw_used: 1,
          free_draw_remaining: 0,
          draw: result,
        },
      },
    })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: result },
  })
  renderPage()

  expect(
    await screen.findByText('Free draws remaining today: 1/1')
  ).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Egg 1' }))
  expect(
    await screen.findByText('Free draws remaining today: 0/1')
  ).toBeVisible()
})

it('restores an existing draw and does not allow another', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...status,
        draw: { day: status.day, egg: 1, prize_name: '', quota: 0 },
      },
    },
  })
  renderPage()

  expect(await screen.findByText('No prize this time')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Egg 1' })).toBeDisabled()
})

it('allows retrying when the status cannot be loaded', async () => {
  vi.spyOn(api, 'get')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ data: { success: true, data: status } })
  renderPage()

  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: 'Egg 1' })).toBeEnabled()
})
