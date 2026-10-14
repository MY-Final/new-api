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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { TicketSettingsDialog } from '../components/ticket-settings-dialog'

const storage = {
  enabled: false,
  retention_days: 30,
  endpoint: '',
  bucket: '',
  notify_email: '',
  credentials_configured: false,
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

function showSettings() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <TicketSettingsDialog onClose={vi.fn()} />
    </QueryClientProvider>
  )
}

it('rejects retention below 30 days and requires confirmation for permanent deletion', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/admin/tickets/storage'
          ? storage
          : { support_tickets_enabled: true },
    },
  }))
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: { deleted: 3 } } })
  showSettings()
  const days = screen.getByRole('spinbutton', {
    name: 'Delete closed tickets older than (days)',
  })
  await user.clear(days)
  await user.type(days, '29')
  expect(
    screen.getByRole('button', { name: 'Clean up tickets' })
  ).toBeDisabled()
  await user.clear(days)
  await user.type(days, '180')
  await user.click(screen.getByRole('button', { name: 'Clean up tickets' }))
  const confirmation = await screen.findByRole('alertdialog')
  expect(confirmation).toHaveTextContent('180 days')
  expect(post).not.toHaveBeenCalled()
  await user.click(
    within(confirmation).getByRole('button', { name: 'Continue' })
  )
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Deleted 3 tickets'
  )
  expect(post).toHaveBeenCalledWith('/api/admin/tickets/cleanup', { days: 180 })
})

it('disables intake through the existing settings API and refreshes its displayed state', async () => {
  const user = userEvent.setup()
  let enabled = true
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/admin/tickets/storage'
          ? storage
          : { support_tickets_enabled: enabled },
    },
  }))
  const put = vi.spyOn(api, 'put').mockImplementation(async () => {
    enabled = false
    return { data: { success: true } }
  })
  showSettings()
  await user.click(await screen.findByRole('button', { name: 'Disable' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'SupportTicketsEnabled',
      value: 'false',
    })
  )
  expect(await screen.findByRole('button', { name: 'Enable' })).toBeEnabled()
  expect(
    screen.getByText(
      'Existing tickets remain accessible when submissions are disabled.'
    )
  ).toBeVisible()
})

it('saves R2 credentials with the image switch and clears secret fields after success', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: storage },
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: { ...storage, enabled: true, credentials_configured: true },
    },
  })
  showSettings()
  await user.click(
    await screen.findByRole('switch', { name: 'Allow ticket images' })
  )
  await user.type(
    screen.getByLabelText('R2 S3 API endpoint'),
    ' https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com '
  )
  await user.type(screen.getByLabelText('R2 bucket'), ' ticket-images ')
  await user.type(screen.getByLabelText('R2 access key ID'), 'access')
  await user.type(screen.getByLabelText('R2 secret access key'), 'secret')
  await user.click(screen.getByRole('button', { name: 'Save Settings' }))
  expect(await screen.findByText('Saved successfully')).toBeVisible()
  expect(put).toHaveBeenCalledWith('/api/admin/tickets/storage', {
    enabled: true,
    retention_days: 30,
    endpoint:
      'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    bucket: 'ticket-images',
    access_key: 'access',
    secret_key: 'secret',
    notify_email: '',
  })
  expect(screen.getByLabelText('R2 access key ID')).toHaveValue('')
  expect(screen.getByLabelText('R2 secret access key')).toHaveValue('')
})

it('keeps the R2 draft after save failure and rejects invalid retention', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: storage },
  })
  const put = vi.spyOn(api, 'put').mockRejectedValue(new Error('Offline'))
  showSettings()
  await user.type(await screen.findByLabelText('R2 bucket'), 'ticket-images')
  await user.click(screen.getByRole('button', { name: 'Save Settings' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeEnabled()
  )
  expect(screen.getByLabelText('R2 bucket')).toHaveValue('ticket-images')
  expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument()
  const retention = screen.getByRole('spinbutton', {
    name: 'Image retention (days)',
  })
  await user.clear(retention)
  await user.type(retention, '366')
  await user.click(screen.getByRole('button', { name: 'Save Settings' }))
  expect(put).toHaveBeenCalledTimes(1)
})

it('saves the notification email that receives new ticket alerts', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: storage },
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: { ...storage, notify_email: 'ops@example.com' },
    },
  })
  showSettings()
  await user.type(
    await screen.findByLabelText('Notification Email'),
    'ops@example.com'
  )
  await user.click(screen.getByRole('button', { name: 'Save Settings' }))
  expect(await screen.findByText('Saved successfully')).toBeVisible()
  expect(put).toHaveBeenCalledWith(
    '/api/admin/tickets/storage',
    expect.objectContaining({ notify_email: 'ops@example.com' })
  )
})

it('rejects an invalid notification email before saving', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: storage },
  })
  const put = vi.spyOn(api, 'put')
  showSettings()
  await user.type(
    await screen.findByLabelText('Notification Email'),
    'not-an-email'
  )
  await user.click(screen.getByRole('button', { name: 'Save Settings' }))
  expect(
    await screen.findByText('Enter a valid notification email address')
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
})
