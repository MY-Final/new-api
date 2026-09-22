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
import { render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ContactDialog } from '../contact-dialog'

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Contact Us': 'Contact Us',
        'Join QQ Group': 'Join QQ Group',
        'QQ Group Number': 'QQ Group Number',
        'QQ group QR code': 'QQ group QR code',
        'Questions, announcements and communication are welcome.':
          'Questions, announcements and communication are welcome.',
        'Scan the QR code to join, or use the link below.':
          'Scan the QR code to join, or use the link below.',
      },
    },
  },
})

const clients: QueryClient[] = []

function renderDialog(status: Record<string, unknown>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  client.setQueryData(['status'], status, { updatedAt: Date.now() + 60_000 })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ContactDialog open onOpenChange={vi.fn()} />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  for (const client of clients) client.clear()
  clients.length = 0
})

describe('contact dialog', () => {
  test('shows an empty state until contact details are configured', () => {
    renderDialog({})

    expect(
      screen.getByRole('dialog', { name: 'Contact Us' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('No contact information has been configured.')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: 'QQ group QR code' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Join QQ Group' })
    ).not.toBeInTheDocument()
  })

  test('renders the configured contact details and uploaded QR image', () => {
    renderDialog({
      contact: {
        title: 'Need help?',
        description: 'Reach us on QQ.',
        qq_group_number: '123456789',
        qq_group_url: 'https://example.com/qq',
        qrcode_version: 'deadbeef',
      },
    })

    expect(
      screen.getByRole('dialog', { name: 'Need help?' })
    ).toBeInTheDocument()
    expect(screen.getByText('Reach us on QQ.')).toBeInTheDocument()
    expect(screen.getByText('123456789')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Join QQ Group' })
    ).toHaveAttribute('href', 'https://example.com/qq')
    expect(
      screen.getByRole('img', { name: 'QQ group QR code' })
    ).toHaveAttribute('src', '/api/contact/qrcode?v=deadbeef')
  })
})
