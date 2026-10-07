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
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { PlaygroundEmptyState } from '../playground-empty-state'

const getApiKeys = vi.hoisted(() => vi.fn())

vi.mock('@/features/keys/api', () => ({
  getApiKeys,
}))

beforeEach(() => {
  getApiKeys.mockReset()
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'playground-user',
    role: 1,
    quota: 1000000,
  })
})

async function renderEmptyState() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <PlaygroundEmptyState onSelectPrompt={() => undefined} />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('Playground empty state setup guidance', () => {
  test('offers API key creation when no enabled key exists', async () => {
    getApiKeys.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 1, name: 'Disabled', status: 2 }],
      },
    })

    await renderEmptyState()

    expect(await screen.findByText('Before you send')).toBeInTheDocument()
    expect(
      screen.getByText('Create or enable an API key before sending a request.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Go to API Keys' })
    ).toHaveAttribute('href', '/keys')
    expect(
      screen.queryByText(
        'Your wallet balance is zero or negative. Add funds before sending a request.'
      )
    ).not.toBeInTheDocument()
  })

  test.each([0, -1])(
    'offers wallet funding when the wallet balance is %s',
    async (quota) => {
      useAuthStore.getState().auth.setUser({
        id: 1,
        username: 'playground-user',
        role: 1,
        quota,
      })
      getApiKeys.mockResolvedValue({
        success: true,
        data: {
          items: [{ id: 1, name: 'Primary', status: 1 }],
        },
      })

      await renderEmptyState()

      expect(await screen.findByText('Before you send')).toBeInTheDocument()
      expect(
        screen.getByText(
          'Your wallet balance is zero or negative. Add funds before sending a request.'
        )
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add Funds' })).toHaveAttribute(
        'href',
        '/wallet'
      )
      expect(
        screen.queryByText(
          'Create or enable an API key before sending a request.'
        )
      ).not.toBeInTheDocument()
    }
  )

  test('does not show setup guidance when prerequisites are ready', async () => {
    getApiKeys.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 1, name: 'Primary', status: 1 }],
      },
    })

    await renderEmptyState()

    await waitFor(() => expect(getApiKeys).toHaveBeenCalledOnce())
    expect(screen.queryByText('Before you send')).not.toBeInTheDocument()
  })
})
