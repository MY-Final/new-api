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

import { CreateTicketDialog } from '../components/create-ticket-dialog'
import { encodeScreenshots } from '../lib/screenshots'
import { ticketSchema } from '../lib/ticket-form'

afterEach(() => vi.restoreAllMocks())

function showCreation(imagesEnabled = true) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  client.setQueryData(['status'], {
    ticket_images_enabled: imagesEnabled,
    ticket_image_retention_days: 30,
  })
  const onCreated = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CreateTicketDialog onClose={vi.fn()} onCreated={onCreated} />
    </QueryClientProvider>
  )
  return onCreated
}

it('hides uploads when images are disabled and still accepts a text ticket', async () => {
  const user = userEvent.setup()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: { id: 42 } } })
  const created = showCreation(false)
  expect(screen.queryByLabelText('Screenshots')).not.toBeInTheDocument()
  expect(screen.getByText('Ticket image uploads are disabled')).toBeVisible()
  await user.type(screen.getByLabelText('Title'), 'Text ticket')
  await user.type(
    screen.getByLabelText('Problem description'),
    'Please investigate'
  )
  await user.click(screen.getByRole('button', { name: 'Submit ticket' }))
  await waitFor(() => expect(created).toHaveBeenCalledWith(42))
  expect(post.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({ screenshots: [] })
  )
})

it('rejects blank descriptions and overlong titles before submission', () => {
  const valid = {
    title: 'Failed request',
    category: 'api',
    content: 'Please investigate',
    request_id: '',
    order_number: '',
    model_name: '',
  }
  expect(ticketSchema.safeParse(valid).success).toBe(true)
  expect(ticketSchema.safeParse({ ...valid, content: '   ' }).success).toBe(
    false
  )
  expect(
    ticketSchema.safeParse({ ...valid, title: 'x'.repeat(161) }).success
  ).toBe(false)
})

it('rejects excessive screenshots, unsupported types and oversized files', async () => {
  const png = new File(['image'], 'error.png', { type: 'image/png' })
  await expect(encodeScreenshots([png, png, png, png])).rejects.toThrow(
    'Choose up to 3'
  )
  await expect(
    encodeScreenshots([
      new File(['image'], 'error.svg', { type: 'image/svg+xml' }),
    ])
  ).rejects.toThrow('Choose up to 3')
  const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', {
    type: 'image/png',
  })
  await expect(encodeScreenshots([large])).rejects.toThrow('Choose up to 3')
})

it('changes category to show the corresponding reference fields', async () => {
  const user = userEvent.setup()
  showCreation()
  expect(screen.getByLabelText('Request ID')).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: 'Category' }))
  await user.click(
    await screen.findByRole('option', { name: 'Payments and orders' })
  )
  expect(screen.getByLabelText('Order number')).toBeVisible()
  expect(screen.queryByLabelText('Request ID')).not.toBeInTheDocument()
})

it('keeps description and screenshot after failure and retries without duplicate creation', async () => {
  const user = userEvent.setup()
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ data: { success: true, data: { id: 42 } } })
  const created = showCreation()
  expect(
    screen.getByText('Images expire after 30 days. Ticket messages are kept.')
  ).toBeVisible()
  await user.type(screen.getByLabelText('Title'), 'Failed API request')
  await user.type(
    screen.getByLabelText('Problem description'),
    'Please investigate request-42'
  )
  const file = new File(['screenshot'], 'error.png', { type: 'image/png' })
  await user.upload(screen.getByLabelText('Screenshots'), file)
  await user.click(screen.getByRole('button', { name: 'Submit ticket' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Submit ticket' })).toBeEnabled()
  )
  expect(screen.getByLabelText('Problem description')).toHaveValue(
    'Please investigate request-42'
  )
  expect(
    (screen.getByLabelText('Screenshots') as HTMLInputElement).files?.[0]
  ).toBe(file)
  expect(created).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Submit ticket' }))
  await waitFor(() => expect(created).toHaveBeenCalledWith(42))
  expect(post.mock.calls[1]?.[1]).toEqual(post.mock.calls[0]?.[1])
})

it('disables editing and submission while the request is pending', async () => {
  const user = userEvent.setup()
  let finish!: (result: {
    data: { success: boolean; data: { id: number } }
  }) => void
  vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const created = showCreation()
  await user.type(screen.getByLabelText('Title'), 'Failure')
  await user.type(
    screen.getByLabelText('Problem description'),
    'Please investigate'
  )
  await user.click(screen.getByRole('button', { name: 'Submit ticket' }))
  expect(
    await screen.findByRole('button', { name: 'Submitting...' })
  ).toBeDisabled()
  expect(screen.getByLabelText('Title')).toBeDisabled()
  expect(screen.getByLabelText('Screenshots')).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Time of occurrence' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  finish({ data: { success: true, data: { id: 42 } } })
  await waitFor(() => expect(created).toHaveBeenCalledWith(42))
})
