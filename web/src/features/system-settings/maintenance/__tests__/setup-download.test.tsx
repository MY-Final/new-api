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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { parseHeaderNavModules, serializeHeaderNavModules } from '../config'
import { HeaderNavigationSection } from '../header-navigation-section'

const clients: QueryClient[] = []

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

function Fixture(props: { initial: string }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const config = parseHeaderNavModules(props.initial)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <HeaderNavigationSection
          config={config}
          initialSerialized={serializeHeaderNavModules(config)}
        />
      </SettingsPageProvider>
    </>
  )
}

it.each([
  { initial: '{"docs":false,"custom":true}', checked: true },
  {
    initial: '{"docs":false,"custom":true,"setupDownload":false}',
    checked: false,
  },
])(
  'saves the Setup download toggle and refreshes public settings from $initial',
  async ({ initial, checked }) => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const client = new QueryClient({
      defaultOptions: {
        queries: { enabled: false, retry: false },
        mutations: { retry: false },
      },
    })
    clients.push(client)
    client.setQueryData(['status'], {})
    render(
      <QueryClientProvider client={client}>
        <Fixture initial={initial} />
      </QueryClientProvider>
    )
    const user = userEvent.setup()
    const toggle = screen.getByRole('switch', { name: 'Download Setup' })
    expect(toggle).toHaveAttribute('aria-checked', String(checked))
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', String(!checked))
    await user.click(screen.getByRole('button', { name: 'Save navigation' }))

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/option/', {
        key: 'HeaderNavModules',
        value: expect.any(String),
      })
    )
    const request = put.mock.calls[0][1] as { key: string; value: string }
    const saved = JSON.parse(request.value)
    expect(saved).toMatchObject({
      setupDownload: !checked,
      docs: false,
      custom: true,
    })
    await waitFor(() =>
      expect(client.getQueryState(['status'])?.isInvalidated).toBe(true)
    )

    await user.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  }
)
