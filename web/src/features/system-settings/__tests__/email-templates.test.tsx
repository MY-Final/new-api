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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../components/settings-page-context'
import { EmailTemplateSection } from '../integrations/email-template-section'

const defaults = JSON.stringify([
  {
    key: 'verify',
    subject: 'Default {{.SystemName}} subject',
    body: '<p>{{.Code}}</p>',
    variables: ['SystemName', 'Code'],
  },
  {
    key: 'ticket',
    subject: 'Ticket {{.TicketID}}',
    body: '<p>{{.Content}}</p>',
    variables: ['TicketID', 'Content'],
  },
])

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function showSection(templates: string, layout = '{}') {
  const actions = document.createElement('div')
  document.body.appendChild(actions)
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <EmailTemplateSection
          templates={templates}
          defaults={defaults}
          layout={layout}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
}

async function openTemplate(
  user: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await user.click(screen.getByRole('tab', { name }))
}

it('shows one template at a time and falls back to the default template', async () => {
  const user = userEvent.setup()
  showSection(
    JSON.stringify({ ticket: { subject: 'Custom', body: '<p>custom</p>' } })
  )
  expect(screen.getByRole('tab', { name: 'Global settings' })).toBeVisible()
  await openTemplate(user, 'Verification code')
  expect(screen.getByLabelText('Subject')).toHaveValue(
    'Default {{.SystemName}} subject'
  )
  await openTemplate(user, 'Ticket notification')
  expect(screen.getByLabelText('Subject')).toHaveValue('Custom')
  expect(screen.getByLabelText('Body')).toHaveValue('<p>custom</p>')
  expect(screen.getByRole('button', { name: '{{.TicketID}}' })).toBeVisible()
})

it('inserts a clicked variable into the focused field at the cursor', async () => {
  const user = userEvent.setup()
  showSection('{}')
  await openTemplate(user, 'Ticket notification')
  const subject = screen.getByLabelText('Subject')
  await user.clear(subject)
  await user.type(subject, 'Ticket ')
  await user.click(screen.getByRole('button', { name: '{{.TicketID}}' }))
  await waitFor(() => expect(subject).toHaveValue('Ticket {{.TicketID}}'))
})

it('saves every template as a single email template option', async () => {
  const user = userEvent.setup()
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  showSection('{}')
  await openTemplate(user, 'Ticket notification')
  const subject = screen.getByLabelText('Subject')
  await user.clear(subject)
  await user.type(subject, 'Edited ticket subject')
  await user.click(screen.getByRole('button', { name: 'Save email templates' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/option/',
      expect.objectContaining({ key: 'EmailTemplates' })
    )
  )
  const request = put.mock.calls.find(
    ([, payload]) => (payload as { key: string }).key === 'EmailTemplates'
  )?.[1] as { value: string }
  const saved = JSON.parse(request.value)
  expect(saved.ticket.subject).toBe('Edited ticket subject')
  expect(saved.verify.subject).toBe('Default {{.SystemName}} subject')
})

it('restores the built-in template before saving', async () => {
  const user = userEvent.setup()
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  showSection(
    JSON.stringify({ ticket: { subject: 'Custom', body: '<p>custom</p>' } })
  )
  await openTemplate(user, 'Ticket notification')
  await user.click(screen.getByRole('button', { name: 'Restore default' }))
  expect(screen.getByLabelText('Subject')).toHaveValue('Ticket {{.TicketID}}')
  await user.click(screen.getByRole('button', { name: 'Save email templates' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/option/',
      expect.objectContaining({ key: 'EmailTemplates' })
    )
  )
  const request = put.mock.calls.find(
    ([, payload]) => (payload as { key: string }).key === 'EmailTemplates'
  )?.[1] as { value: string }
  expect(JSON.parse(request.value).ticket.subject).toBe('Ticket {{.TicketID}}')
})

it('saves the brand and footer as the email layout option', async () => {
  const user = userEvent.setup()
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  showSection('{}')
  await user.type(screen.getByLabelText('Brand name'), 'kuncode')
  await user.type(screen.getByLabelText('Footer text'), 'kuncode team')
  await user.click(screen.getByRole('button', { name: 'Save email templates' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'EmailLayout',
      value: JSON.stringify({ brand: 'kuncode', footer: 'kuncode team' }),
    })
  )
})

it('prefills the stored brand and footer for editing', async () => {
  showSection(
    '{}',
    JSON.stringify({ brand: 'kuncode', footer: 'kuncode team' })
  )
  expect(screen.getByLabelText('Brand name')).toHaveValue('kuncode')
  expect(screen.getByLabelText('Footer text')).toHaveValue('kuncode team')
})

it('previews the unsaved draft with server-rendered sample values', async () => {
  const user = userEvent.setup()
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: { subject: 'Rendered subject', html: '<p>Rendered body</p>' },
    },
  })
  showSection('{}')
  await user.type(screen.getByLabelText('Brand name'), 'kuncode')
  await openTemplate(user, 'Ticket notification')
  const subject = screen.getByLabelText('Subject')
  await user.clear(subject)
  await user.type(subject, 'Edited ticket subject')
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  await waitFor(
    () =>
      expect(post).toHaveBeenCalledWith('/api/option/email_templates/preview', {
        key: 'ticket',
        subject: 'Edited ticket subject',
        body: '<p>{{.Content}}</p>',
        brand: 'kuncode',
        footer: '',
      }),
    { timeout: 3000 }
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Ticket notification',
  })
  expect(within(dialog).getByText('Rendered subject')).toBeVisible()
  expect(within(dialog).getByTitle('Ticket notification')).toHaveAttribute(
    'srcdoc',
    '<p>Rendered body</p>'
  )
})
