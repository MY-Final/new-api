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

it('prefills stored overrides and falls back to the default template', async () => {
  showSection(
    JSON.stringify({ ticket: { subject: 'Custom', body: '<p>custom</p>' } })
  )
  expect(screen.getAllByLabelText('Subject')[0]).toHaveValue(
    'Default {{.SystemName}} subject'
  )
  expect(screen.getAllByLabelText('Subject')[1]).toHaveValue('Custom')
  expect(screen.getAllByLabelText('Body')[1]).toHaveValue('<p>custom</p>')
  expect(screen.getByText('{{.TicketID}} {{.Content}}')).toBeVisible()
})

it('saves every template as a single email template option', async () => {
  const user = userEvent.setup()
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  showSection('{}')
  const subjects = screen.getAllByLabelText('Subject')
  await user.clear(subjects[1])
  await user.type(subjects[1], 'Custom ticket subject')
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
  expect(saved.ticket.subject).toBe('Custom ticket subject')
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
  await user.click(
    screen.getAllByRole('button', { name: 'Restore default' })[1]
  )
  expect(screen.getAllByLabelText('Subject')[1]).toHaveValue(
    'Ticket {{.TicketID}}'
  )
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
  const subject = screen.getAllByLabelText('Subject')[1]
  await user.clear(subject)
  await user.type(subject, 'Edited ticket subject')
  await user.click(screen.getAllByRole('button', { name: 'Preview' })[1])
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/option/email_templates/preview', {
      key: 'ticket',
      subject: 'Edited ticket subject',
      body: '<p>{{.Content}}</p>',
      brand: 'kuncode',
      footer: '',
    })
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
