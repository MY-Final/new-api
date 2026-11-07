import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { DailyEggRecords } from '../components/daily-egg/daily-egg-records'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('daily egg records', () => {
  it('shows prizes and records and filters by user and prize', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation(async (_url, config) => ({
        data: {
          success: true,
          data: {
            day: config?.params?.day || '2026-11-07',
            today: '2026-11-07',
            total: 1,
            prizes: [
              {
                id: 'first',
                name: 'First',
                quantity: 5,
                issued: 2,
                remaining: 3,
              },
            ],
            items: [
              {
                id: 1,
                user_id: 8,
                username: 'alice',
                egg: 2,
                prize_name: 'First',
                quota: 100,
                created_at: 1794009600,
              },
            ],
          },
        },
      }))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <DailyEggRecords />
      </QueryClientProvider>
    )
    const row = await screen.findByRole('row', { name: /alice/ })
    expect(within(row).getByText('First')).toBeVisible()
    expect(within(row).getByText('2')).toBeVisible()
    expect(screen.getByText("Today's prize inventory")).toBeVisible()
    expect(screen.getByText('3')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'alice' },
    })
    fireEvent.change(screen.getByLabelText('Prize'), {
      target: { value: 'First' },
    })
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        '/api/daily_egg/records',
        expect.objectContaining({
          params: expect.objectContaining({
            username: 'alice',
            prize: 'First',
            p: 1,
          }),
        })
      )
    )
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-11-06' },
    })
    await waitFor(() =>
      expect(
        screen.queryByText("Today's prize inventory")
      ).not.toBeInTheDocument()
    )
    client.clear()
  })
})
