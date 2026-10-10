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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import { serializeCustomPages } from '@/lib/custom-pages'

import { CustomPagesSection } from '../custom-pages-section'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en } })

function renderSection(value: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <CustomPagesSection
          value={value}
          initialSerialized={serializeCustomPages([])}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

afterEach(() => {
  cleanup()
})

it('lists the configured pages and appends an empty row', async () => {
  const user = userEvent.setup()
  renderSection(
    JSON.stringify([
      {
        name: 'Status page',
        url: 'https://status.example.com',
        adminOnly: false,
      },
    ])
  )

  expect(screen.getByDisplayValue('Status page')).toBeInTheDocument()
  expect(
    screen.getByDisplayValue('https://status.example.com')
  ).toBeInTheDocument()
  expect(screen.getByText('Embedded pages')).toBeInTheDocument()
  // The limit hint must interpolate the count, not print the placeholder.
  expect(
    screen.getByText(
      'Maximum 20 pages. Menu names must be unique; the page URL stays on the server for admin-only entries.'
    )
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Add page' }))

  const nameInputs = screen.getAllByLabelText('Menu name')
  expect(nameInputs).toHaveLength(2)
  expect(nameInputs[1]).toHaveValue('')
  expect(screen.getAllByRole('switch', { name: 'Admins only' })).toHaveLength(2)
})

it('removes a page row and shows the empty hint when none are left', async () => {
  const user = userEvent.setup()
  renderSection(
    JSON.stringify([
      { name: 'Monitoring', url: 'https://mon.example.com', adminOnly: true },
    ])
  )

  await user.click(screen.getByRole('button', { name: 'Remove page' }))

  expect(
    screen.getByText('No custom pages yet. Add one to show it in the sidebar.')
  ).toBeInTheDocument()
  expect(screen.queryByLabelText('Menu name')).not.toBeInTheDocument()
})
