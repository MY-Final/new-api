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

import { FreeGroupUsage } from '../components/free-group/free-group-usage'

function renderUsage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <FreeGroupUsage />
    </QueryClientProvider>
  )
  return client
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('free group usage', () => {
  it('shows the global limit and ranked user calls, then filters by username', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation(async (_url, config) => ({
        data: {
          success: true,
          data: {
            day: '2026-11-07',
            today: '2026-11-07',
            enabled: true,
            group: 'free',
            daily_limit: 10,
            user_limit: 5,
            used: 7,
            total: 1,
            items: [
              {
                user_id: 8,
                username:
                  (config?.params as { username?: string } | undefined)
                    ?.username || 'alice',
                count: 4,
                rejected_count: 3,
                last_rejected_at: 1794009600,
              },
            ],
          },
        },
      }))
    const client = renderUsage()
    expect(await screen.findByText('alice')).toBeVisible()
    expect(screen.getByText('Remaining today')).toBeVisible()
    expect(
      within(screen.getByRole('row', { name: /alice/ })).getByText('4')
    ).toBeVisible()
    expect(
      within(screen.getByRole('row', { name: /alice/ })).getByText('3')
    ).toBeVisible()
    expect(screen.getByText('Last limit rejection')).toBeVisible()
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), {
      target: { value: 'bob' },
    })
    expect(await screen.findByText('bob')).toBeVisible()
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        '/api/free_group/users',
        expect.objectContaining({
          params: expect.objectContaining({ username: 'bob', p: 1 }),
        })
      )
    )
    client.clear()
  })

  it('shows an error state when the request fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('unavailable'))
    const client = renderUsage()
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible()
    client.clear()
  })

  it('shows the selected day without applying today’s limits to history', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (_url, config) => ({
      data: {
        success: true,
        data: {
          day: (config?.params as { day?: string } | undefined)?.day || '2026-11-07',
          today: '2026-11-07',
          enabled: true,
          group: 'free',
          daily_limit: 10,
          user_limit: 5,
          used: 3,
          total: 0,
          items: [],
        },
      },
    }))
    const client = renderUsage()
    expect(await screen.findByText('Daily limit')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-11-06' },
    })
    expect(
      await screen.findByText('No records found. Try adjusting your filters.')
    ).toBeVisible()
    expect(screen.queryByText('Daily limit')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-06')
    client.clear()
  })
})
