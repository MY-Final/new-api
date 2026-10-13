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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { TicketComposer } from '../components/ticket-composer'
import type { TicketMessageInput } from '../types'

afterEach(() => vi.restoreAllMocks())

function showReply(staff: boolean, canReply = true, canManage = true) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={client}>
      <TicketComposer
        id={42}
        staff={staff}
        canReply={canReply}
        canManage={canManage}
      />
    </QueryClientProvider>
  )
}

it('hides reply controls from staff without reply permission', () => {
  showReply(true, false)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
})

it('offers customers only public replies and sends through their own endpoint', async () => {
  const user = userEvent.setup()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  showReply(false)
  expect(
    screen.queryByRole('button', { name: 'Internal note' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Reply and resolve' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  await user.type(
    screen.getByRole('textbox', { name: 'Reply' }),
    'Still failing'
  )
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('')
  )
  expect(post).toHaveBeenCalledWith(
    '/api/tickets/42/messages',
    expect.objectContaining({ content: 'Still failing', resolve: false })
  )
})

it('keeps an internal note private and preserves its draft and key after failed submission', async () => {
  const user = userEvent.setup()
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ data: { success: true } })
  showReply(true)
  await user.click(screen.getByRole('button', { name: 'Internal note' }))
  expect(screen.getByRole('button', { name: 'Internal note' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(
    screen.queryByRole('button', { name: 'Reply and resolve' })
  ).not.toBeInTheDocument()
  await user.type(
    screen.getByRole('textbox', { name: 'Only staff can see this note' }),
    'Internal investigation'
  )
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  )
  expect(screen.getByRole('textbox')).toHaveValue('Internal investigation')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
  expect(post.mock.calls[0]?.[0]).toBe('/api/admin/tickets/42/notes')
  expect(post.mock.calls[1]?.[1]).toEqual(post.mock.calls[0]?.[1])
})

it('omits resolve action for staff who can reply but cannot manage tickets', () => {
  showReply(true, true, false)
  expect(screen.getByRole('button', { name: 'Internal note' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Reply and resolve' })
  ).not.toBeInTheDocument()
})

it('allows a new successful reply with identical text while retaining retry deduplication', async () => {
  const user = userEvent.setup()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  showReply(false)
  for (const count of [1, 2]) {
    await user.type(
      screen.getByRole('textbox', { name: 'Reply' }),
      'Still failing'
    )
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(count))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('')
    )
  }
  const keys = post.mock.calls.map(
    ([, input]) => (input as TicketMessageInput).request_key
  )
  expect(keys[1]).not.toBe(keys[0])
})
