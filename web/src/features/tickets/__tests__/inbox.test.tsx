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
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { TicketsPage } from '..'

const ticket = {
  id: 9,
  user_id: 7,
  title: 'Cannot call the API',
  category: 'api',
  status: 'pending',
  assignee_id: 0,
  version: 1,
  request_id: '',
  order_number: '',
  model_name: '',
  occurred_at: 0,
  created_at: 1700000000,
  updated_at: 1700000000,
  unread: true,
  user_name: 'alice',
  assignee_name: '',
  preview: 'The request returns 500',
  preview_sender_type: 'user',
}

const stats = {
  pending: 3,
  processing: 1,
  waiting: 0,
  resolved: 0,
  closed: 0,
  all: 4,
  unread: 2,
}

beforeEach(() =>
  useAuthStore.getState().auth.setUser({ id: 2, username: 'staff', role: 1 })
)

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

function showInbox() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <TicketsPage staff />
    </QueryClientProvider>
  )
}

function mockInbox() {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    const path = String(url)
    if (path.endsWith('/stats')) {
      return { data: { success: true, data: stats } }
    }
    if (path === '/api/admin/tickets') {
      return {
        data: {
          success: true,
          data: { items: [ticket], total: 1, page: 1, page_size: 30 },
        },
      }
    }
    if (path === '/api/admin/tickets/9') {
      return {
        data: {
          success: true,
          data: {
            ticket,
            requester: { id: 7, username: 'alice', email: 'alice@example.com' },
            messages: [
              {
                id: 1,
                sender_id: 7,
                sender_type: 'user',
                sender_name: 'alice',
                content: 'The request returns 500',
                created_at: 1700000000,
                attachments: [],
              },
            ],
            events: [],
            has_more: false,
          },
        },
      }
    }
    return { data: { success: true, data: {} } }
  })
}

it('starts staff in pending tickets and shows the folder counters', async () => {
  const get = mockInbox()
  showInbox()
  expect(await screen.findByText(/The request returns 500/)).toBeVisible()
  expect(get).toHaveBeenCalledWith('/api/admin/tickets', {
    params: {
      p: 1,
      page_size: 30,
      status: 'pending',
      category: '',
      keyword: '',
    },
  })
  const sidebar = screen.getByRole('complementary', { name: 'Status' })
  expect(
    within(sidebar).getByRole('button', { name: /Pending/ })
  ).toHaveTextContent('3')
  expect(
    within(sidebar).getByRole('button', { name: /Unread/ })
  ).toHaveTextContent('2')
})

it('shows the requester and last message, then opens the detail inline', async () => {
  const user = userEvent.setup()
  mockInbox()
  showInbox()
  expect(await screen.findByText('alice (#7)')).toBeVisible()
  expect(screen.getByText(/The request returns 500/)).toBeVisible()
  expect(screen.queryByLabelText('Conversation')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Cannot call the API/ }))
  expect(await screen.findByLabelText('Conversation')).toBeVisible()
  expect(screen.getByText('alice@example.com')).toBeVisible()
})

it('filters the unread folder through the list API', async () => {
  const user = userEvent.setup()
  const get = mockInbox()
  showInbox()
  await screen.findByText(/The request returns 500/)
  const sidebar = screen.getByRole('complementary', { name: 'Status' })
  await user.click(within(sidebar).getByRole('button', { name: /Unread/ }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/api/admin/tickets', {
      params: {
        p: 1,
        page_size: 30,
        status: '',
        category: '',
        keyword: '',
        unread: 'true',
      },
    })
  )
})

it('searches only after the staff submits the keyword', async () => {
  const user = userEvent.setup()
  const get = mockInbox()
  showInbox()
  await screen.findByText(/The request returns 500/)
  const search = screen.getByRole('textbox', { name: 'Search tickets' })
  await user.type(search, '#42')
  expect(
    get.mock.calls.some(
      ([url, config]) =>
        url === '/api/admin/tickets' &&
        (config as { params?: { keyword?: string } } | undefined)?.params
          ?.keyword === '#42'
    )
  ).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/api/admin/tickets', {
      params: {
        p: 1,
        page_size: 30,
        status: 'pending',
        category: '',
        keyword: '#42',
      },
    })
  )
})
