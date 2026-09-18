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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getMyUsage } from '../api'
import { UsageStatistics } from '../index'
import type { UserUsage } from '../types'

vi.mock('../api', () => ({
  getMyUsage: vi.fn(),
  getUserUsageRequests: vi.fn(async () => ({
    success: true,
    data: { items: [], total: 0, page: 1, page_size: 20 },
  })),
}))

const getMyUsageMock = vi.mocked(getMyUsage)

const emptyUsage: UserUsage = {
  user: {
    id: 1,
    username: 'usage-user',
    display_name: '',
    quota: 0,
    used_quota: 0,
    request_count: 0,
  },
  summary: {
    request_count: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    consumed_quota: 0,
    refunded_quota: 0,
    net_quota: 0,
    user_cost: 0,
  },
  daily: [],
  models: [],
}

let client: QueryClient

beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  getMyUsageMock.mockResolvedValue({ success: true, data: emptyUsage })
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
  localStorage.clear()
})

async function renderUsageStatistics() {
  const router = createRouter({
    routeTree: createRootRoute({ component: UsageStatistics }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('usage statistics empty state', () => {
  it('guides new users to create an API key instead of showing empty charts', async () => {
    await renderUsageStatistics()

    expect(await screen.findByText('No usage data')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create API Key' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Period Summary')).not.toBeInTheDocument()
    expect(screen.queryByText('Usage Trends')).not.toBeInTheDocument()
    expect(screen.queryByText('Request Details')).not.toBeInTheDocument()
  })
})
