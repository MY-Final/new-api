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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { Hero } from '../components/sections/hero'

const clients: QueryClient[] = []

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

it.each([false, true])(
  'offers the public Setup download when authenticated=%s while preserving the main action',
  async (isAuthenticated) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    })
    client.setQueryData(['status'], {})
    clients.push(client)
    const root = createRootRoute({
      component: () => <Hero isAuthenticated={isAuthenticated} />,
    })
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const download = await screen.findByRole('link', { name: 'Download Setup' })
    expect(download).toHaveAttribute(
      'href',
      'https://github.com/MY-Final/kuncode-setup/releases/latest'
    )
    expect(download).toHaveAttribute('target', '_blank')
    expect(download).toHaveAttribute('rel', 'noopener noreferrer')
    expect(
      screen.getByText(
        'Configure Codex, Claude Code, and OpenCode with KunCode Setup. Windows x64.'
      )
    ).toBeVisible()
    const mainAction = isAuthenticated ? 'Go to Dashboard' : 'Get Started'
    expect(screen.getByRole('button', { name: mainAction })).toHaveAttribute(
      'href',
      isAuthenticated ? '/dashboard' : '/sign-up'
    )

    act(() =>
      client.setQueryData(['status'], {
        HeaderNavModules: JSON.stringify({ setupDownload: false }),
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Download Setup' })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.queryByText(
        'Configure Codex, Claude Code, and OpenCode with KunCode Setup. Windows x64.'
      )
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: mainAction })).toBeInTheDocument()

    act(() =>
      client.setQueryData(['status'], {
        HeaderNavModules: JSON.stringify({ setupDownload: true }),
      })
    )
    expect(
      await screen.findByRole('link', { name: 'Download Setup' })
    ).toBeInTheDocument()
  }
)
