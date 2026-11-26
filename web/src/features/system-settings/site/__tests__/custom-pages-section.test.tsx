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
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import { api } from '@/lib/api'
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
  expect(
    screen.getByText(
      'Menu names must be unique; the page URL stays on the server for admin-only entries.'
    )
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Add page' }))

  const nameInputs = screen.getAllByLabelText('Menu name')
  expect(nameInputs).toHaveLength(2)
  expect(nameInputs[1]).toHaveValue('')
  expect(screen.getAllByRole('switch', { name: 'Admins only' })).toHaveLength(2)
  expect(
    screen.getAllByRole('switch', { name: 'Highlight in sidebar' })
  ).toHaveLength(2)
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

it('offers additional solid and gradient highlights and saves the selected style', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  renderSection(
    JSON.stringify([
      { name: 'Status', url: 'https://status.example.com', highlight: true },
    ])
  )
  const selector = screen.getByRole('combobox', { name: 'Highlight color' })
  await user.click(selector)
  for (const name of [
    'Cyan',
    'Teal',
    'Emerald',
    'Lime',
    'Pink',
    'Rose',
    'Indigo',
    'Slate',
    'Sunset',
    'Ocean',
    'Aurora',
    'Rainbow',
  ]) {
    expect(await screen.findByRole('option', { name })).toBeInTheDocument()
  }
  await user.click(screen.getByRole('option', { name: 'Aurora' }))
  expect(selector).toHaveTextContent('Aurora')
  const form = screen.getByLabelText('Menu name').closest('form')
  if (!form) throw new Error('Custom pages form was not rendered')
  fireEvent.submit(form)
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'CustomPages',
      value: JSON.stringify([
        {
          name: 'Status',
          url: 'https://status.example.com',
          adminOnly: false,
          highlight: true,
          highlightColor: 'aurora',
          inWallet: false,
        },
      ]),
    })
  )
})

it('keeps a saved accent disabled until sidebar highlighting is enabled', async () => {
  const user = userEvent.setup()
  renderSection(
    JSON.stringify([
      {
        name: 'Status',
        url: 'https://status.example.com',
        highlight: false,
        highlightColor: 'cyan',
      },
    ])
  )
  const selector = screen.getByRole('combobox', { name: 'Highlight color' })
  expect(selector).toBeDisabled()
  await user.click(screen.getByRole('switch', { name: 'Highlight in sidebar' }))
  expect(selector).toBeEnabled()
  expect(selector).toHaveTextContent('Cyan')
})
