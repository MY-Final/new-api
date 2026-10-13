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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { TicketsPage } from '../index'

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'owner', role: 1 })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
  localStorage.clear()
})

function showList(staff = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TicketsPage staff={staff} />
    </QueryClientProvider>
  )
}

it('shows an empty list and disables new submissions when the site closes intake', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/status'
          ? { support_tickets_enabled: false }
          : { items: [], total: 0, page: 1, page_size: 20 },
    },
  }))
  showList()
  expect(await screen.findByText('No tickets yet')).toBeVisible()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Submit ticket' })).toBeDisabled()
  )
  expect(screen.getByText('Ticket submissions are disabled')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Search tickets' })).toBeEnabled()
})

it('starts staff in pending tickets and searches only after the user submits', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/status'
          ? { support_tickets_enabled: true }
          : { items: [], total: 0, page: 1, page_size: 20 },
    },
  }))
  showList(true)
  expect(await screen.findByText('No tickets yet')).toBeVisible()
  expect(get).toHaveBeenCalledWith('/api/admin/tickets', {
    params: {
      p: 1,
      page_size: 20,
      status: 'pending',
      category: '',
      keyword: '',
    },
  })
  await user.type(
    screen.getByRole('textbox', { name: 'Search tickets' }),
    '#42'
  )
  expect(
    get.mock.calls.filter(([url]) => url === '/api/admin/tickets')
  ).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/api/admin/tickets', {
      params: {
        p: 1,
        page_size: 20,
        status: 'pending',
        category: '',
        keyword: '#42',
      },
    })
  )
})
