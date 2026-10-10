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
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { CustomPage } from '@/lib/custom-pages'
import en from '@/i18n/locales/en.json'

import { CustomPageEmbed } from '../index'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en } })

function renderEmbed(slug: string, pages: CustomPage[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: pages },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <CustomPageEmbed slug={slug} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return client
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('embeds the configured page in a sandboxed frame with a new-tab escape hatch', async () => {
  renderEmbed('monitoring', [
    { name: 'Monitoring', url: 'https://mon.example.com', adminOnly: true },
  ])

  const frame = await screen.findByTitle('Monitoring')
  expect(frame).toHaveAttribute('src', 'https://mon.example.com')
  // The embedded page keeps its own origin but can never navigate the console.
  expect(frame.getAttribute('sandbox')).toContain('allow-same-origin')
  expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation')
  expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')

  const link = screen.getByRole('link', { name: /Open in new tab/ })
  expect(link).toHaveAttribute('href', 'https://mon.example.com')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

it('explains when the page is not available to this user', async () => {
  renderEmbed('monitoring', [
    { name: 'Status', url: 'https://status.example.com', adminOnly: false },
  ])

  expect(await screen.findByText('Page not found')).toBeInTheDocument()
  expect(screen.queryByTitle('Monitoring')).not.toBeInTheDocument()
})
