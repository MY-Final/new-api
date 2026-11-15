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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { SystemInfoSection } from '../system-info-section'

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  )

  return (
    <QueryClientProvider client={client}>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <SystemInfoSection
          defaultValues={{
            SystemName: 'Test API',
            ServerAddress: '',
            ApiBaseURLs: 'https://api.example.com\nhttps://direct.example.com/',
            TaskPublicAddress: '',
            Logo: '',
            Footer: '',
            About: '',
            HomePageContent: '',
            general_setting: { docs_link: '' },
            legal: { user_agreement: '', privacy_policy: '' },
          }}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
}

async function renderSettings() {
  const route = createRootRoute({ component: Fixture })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

it('loads legacy endpoint URLs as labeled rows and saves the edited list as JSON', async () => {
  const user = userEvent.setup()
  await renderSettings()

  const names = screen.getAllByRole('textbox', { name: 'Name' })
  expect(names).toHaveLength(2)
  const urls = screen.getAllByRole('textbox', { name: 'URL' })
  expect(urls[0]).toHaveValue('https://api.example.com')
  expect(urls[1]).toHaveValue('https://direct.example.com/')

  await user.type(names[0], '默认')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))

  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'ApiBaseURLs',
      value:
        '[{"name":"默认","url":"https://api.example.com"},{"name":"","url":"https://direct.example.com"}]',
    })
  )
})
