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
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { TicketDetailDialog } from '../components/ticket-detail-dialog'
import type { TicketDetail } from '../types'

const detail: TicketDetail = {
  ticket: {
    id: 42,
    user_id: 1,
    title: 'Failed request',
    category: 'api',
    status: 'pending',
    assignee_id: 0,
    version: 4,
    request_id: 'request-42',
    order_number: '',
    model_name: 'model',
    occurred_at: 1700000000,
    created_at: 1700000000,
    updated_at: 1700000000,
    unread: true,
  },
  messages: [
    {
      id: 51,
      sender_id: 1,
      sender_type: 'user',
      content: 'Customer description',
      created_at: 1700000000,
      attachments: [],
    },
  ],
  events: [],
  has_more: false,
}

const screenshotDetail: TicketDetail = {
  ...detail,
  messages: [
    {
      ...detail.messages[0],
      attachments: [{ id: 7, name: 'error.png', content_type: 'image/png' }],
    },
  ],
}

beforeEach(() =>
  useAuthStore.getState().auth.setUser({ id: 1, username: 'owner', role: 1 })
)
afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

function showDetail(staff = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const result = render(
    <QueryClientProvider client={client}>
      <TicketDetailDialog id={42} staff={staff} onClose={vi.fn()} />
    </QueryClientProvider>
  )
  return { ...result, client }
}

it('shows expired screenshots as unavailable while preserving the conversation', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...detail,
        messages: [
          {
            ...detail.messages[0],
            attachments: [
              {
                id: 7,
                name: 'error.png',
                content_type: 'image/png',
                expires_at: 1,
              },
            ],
          },
        ],
      },
    },
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  showDetail()
  expect(
    await screen.findByRole('button', { name: 'error.png · Image expired' })
  ).toBeDisabled()
  expect(screen.getByText('Customer description')).toBeVisible()
  expect(
    get.mock.calls.some(([url]) => String(url).includes('/attachments/'))
  ).toBe(false)
})

it('marks the displayed version read and leaves older message pages unread', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data: config?.params?.before
        ? {
            ...detail,
            messages: [
              { ...detail.messages[0], id: 1, content: 'Older description' },
            ],
            has_more: false,
          }
        : { ...detail, has_more: true },
    },
  }))
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  showDetail()
  expect(await screen.findByText('Customer description')).toBeVisible()
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/tickets/42/read', { version: 4 })
  )
  await user.click(screen.getByRole('button', { name: 'Older messages' }))
  expect(await screen.findByText('Older description')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Latest messages' })).toBeVisible()
  expect(get).toHaveBeenLastCalledWith('/api/tickets/42', {
    params: { before: 51 },
  })
  expect(post).toHaveBeenCalledTimes(1)
})

it('requires confirmation before closing and sends the displayed version', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: detail },
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  const patch = vi
    .spyOn(api, 'patch')
    .mockResolvedValue({ data: { success: true } })
  showDetail()
  await user.click(await screen.findByRole('button', { name: 'Close ticket' }))
  const confirmation = await screen.findByRole('alertdialog')
  expect(patch).not.toHaveBeenCalled()
  expect(confirmation).toHaveTextContent('Close this ticket?')
  await user.click(
    within(confirmation).getByRole('button', { name: 'Close ticket' })
  )
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith('/api/tickets/42', {
      version: 4,
      status: 'closed',
      assignee_id: undefined,
    })
  )
})

it('shows private thumbnails automatically and opens the loaded image with the keyboard', async () => {
  const user = userEvent.setup()
  const blob = new Blob(['private image'], { type: 'image/png' })
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: String(url).includes('/attachments/')
      ? blob
      : { success: true, data: screenshotDetail },
  }))
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  const createURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:private-screenshot')
  const revokeURL = vi
    .spyOn(URL, 'revokeObjectURL')
    .mockImplementation(() => undefined)
  const view = showDetail()
  expect(await screen.findByRole('img', { name: 'error.png' })).toHaveAttribute(
    'src',
    'blob:private-screenshot'
  )
  const thumbnail = screen.getByRole('button', { name: 'error.png' })
  thumbnail.focus()
  await user.keyboard('{Enter}')
  expect(
    within(await screen.findByRole('dialog', { name: 'error.png' })).getByRole(
      'img'
    )
  ).toHaveAttribute('src', 'blob:private-screenshot')
  expect(get).toHaveBeenCalledWith('/api/tickets/42/attachments/7', {
    responseType: 'blob',
  })
  expect(createURL).toHaveBeenCalledWith(blob)
  expect(
    get.mock.calls.filter(([url]) => String(url).includes('/attachments/'))
  ).toHaveLength(1)
  view.unmount()
  expect(revokeURL).toHaveBeenCalledWith('blob:private-screenshot')
})

it('identifies the requester and message authors for staff', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...detail,
        ticket: { ...detail.ticket, user_id: 7 },
        requester: { id: 7, username: 'alice', email: 'alice@example.com' },
        messages: [
          { ...detail.messages[0], sender_id: 7, sender_name: 'alice' },
          {
            id: 52,
            sender_id: 3,
            sender_type: 'admin',
            sender_name: 'support',
            content: 'On it',
            created_at: 1700000001,
            attachments: [],
          },
        ],
      },
    },
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  showDetail(true)
  expect(await screen.findAllByText('alice (#7)')).toHaveLength(2)
  expect(screen.getByText('alice@example.com')).toBeVisible()
  expect(screen.getByText('support (#3)')).toBeVisible()
})

it('keeps the conversation usable when a thumbnail fails and allows retrying', async () => {
  const user = userEvent.setup()
  let fail = true
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (!String(url).includes('/attachments/')) {
      return { data: { success: true, data: screenshotDetail } }
    }
    if (fail) throw new Error('Storage unavailable')
    return { data: new Blob(['image'], { type: 'image/png' }) }
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:retried')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  showDetail()
  const retry = await screen.findByRole('button', { name: 'error.png · Retry' })
  expect(retry).toBeEnabled()
  expect(screen.getByText('Customer description')).toBeVisible()
  fail = false
  await user.click(retry)
  expect(await screen.findByRole('img', { name: 'error.png' })).toHaveAttribute(
    'src',
    'blob:retried'
  )
  fireEvent.error(screen.getByRole('img', { name: 'error.png' }))
  expect(
    screen.getByRole('button', { name: 'error.png · Retry' })
  ).toBeEnabled()
})

it.each([
  ['pending', 'Pending', 'text-warning', 'bg-warning/10'],
  ['processing', 'In progress', 'text-info', 'bg-info/10'],
  ['waiting', 'Waiting for information', 'text-chart-4', 'bg-chart-4/10'],
  ['resolved', 'Resolved', 'text-success', 'bg-success/10'],
  ['closed', 'Closed', 'text-muted-foreground', 'bg-muted'],
] as const)(
  'shows the %s status with its distinct color and readable label',
  async (status, label, color, background) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { ...detail, ticket: { ...detail.ticket, status } },
      },
    })
    vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
    showDetail()
    const badge = (await screen.findByText(label)).closest(
      '[data-slot="status-badge"]'
    )
    expect(badge).toHaveClass(color, background)
  }
)

it('omits mutation controls when staff only have read permission', async () => {
  useAuthStore.getState().auth.setUser({
    id: 2,
    username: 'reader',
    role: 10,
    permissions: {
      admin_permissions: {
        ticket: { read: true, write: false, operate: false },
      },
    },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: detail },
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  showDetail(true)
  expect(await screen.findByText('Customer description')).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('combobox', { name: 'Status' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Assign' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Close ticket' })
  ).not.toBeInTheDocument()
})

it('shows fetch failure and retries to show the conversation', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue({ data: { success: true, data: detail } })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  showDetail()
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('Customer description')).toBeVisible()
})

it('retries a failed read marker while keeping the conversation accessible', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: detail },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue({ data: { success: true } })
  showDetail()
  expect(await screen.findByText('Customer description')).toBeVisible()
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(post.mock.calls[1]).toEqual(post.mock.calls[0])
})
