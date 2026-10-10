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

import { HeaderNavigationSection } from '../header-navigation-section'
import { parseHeaderNavModules, serializeHeaderNavModules } from '../config'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en } })

function renderSection(value: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const config = parseHeaderNavModules(value)
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <HeaderNavigationSection
          config={config}
          initialSerialized={serializeHeaderNavModules(config)}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

afterEach(() => {
  cleanup()
})

it('lists the configured top navigation links', () => {
  renderSection(
    JSON.stringify({
      links: [{ name: '官网', url: 'https://example.com' }],
    })
  )

  expect(screen.getByDisplayValue('官网')).toBeInTheDocument()
  expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument()
  expect(screen.getByText('Custom links')).toBeInTheDocument()
})

it('shows the setup download override and disables it when the entry is hidden', () => {
  renderSection(
    JSON.stringify({
      setupDownload: true,
      setupDownloadUrl: 'https://downloads.example.com/kuncode',
    })
  )

  expect(
    screen.getByLabelText('Setup download URL')
  ).toHaveValue('https://downloads.example.com/kuncode')
  expect(screen.getByLabelText('Setup download URL')).toBeEnabled()

  cleanup()
  renderSection(JSON.stringify({ setupDownload: false }))
  expect(screen.getByLabelText('Setup download URL')).toBeDisabled()
})

it('appends an empty link row and removes it again', async () => {
  const user = userEvent.setup()
  renderSection(JSON.stringify({ links: [] }))

  expect(
    screen.getByText('No custom links yet.')
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Add link' }))

  const nameInputs = screen.getAllByLabelText('Link name')
  expect(nameInputs).toHaveLength(1)
  expect(nameInputs[0]).toHaveValue('')

  await user.click(screen.getByRole('button', { name: 'Remove link' }))

  expect(screen.queryByLabelText('Link name')).not.toBeInTheDocument()
  expect(screen.getByText('No custom links yet.')).toBeInTheDocument()
})
