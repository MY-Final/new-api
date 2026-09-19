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
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'

import type { UserChartsFilters } from '@/features/dashboard/types'

import { getAdminUserUsageRanking } from '../../api'
import { AdminUsageAnalytics } from '../admin-usage-analytics'

vi.mock('../../api', () => ({
  getAdminUserUsageRanking: vi.fn(),
}))

const getRankingMock = vi.mocked(getAdminUserUsageRanking)

const aggregate = {
  request_count: 1,
  prompt_tokens: 10,
  completion_tokens: 5,
  input_tokens: 10,
  output_tokens: 5,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 15,
  user_cost: 20,
  consumed_quota: 20,
  refunded_quota: 0,
  net_quota: 20,
}

const ranking = {
  summary: aggregate,
  activity: { dau: 1, wau: 2, mau: 3 },
  items: [{ user_id: 1, username: 'alice', ...aggregate }],
  total: 1,
  page: 1,
  page_size: 10,
}

const previousAggregate = {
  ...aggregate,
  request_count: 2,
  input_tokens: 20,
  output_tokens: 10,
  total_tokens: 30,
  user_cost: 40,
}

const previousRanking = {
  ...ranking,
  summary: previousAggregate,
}

const initialFilters: UserChartsFilters = {
  timeGranularity: 'hour',
  range: {
    start: new Date('2025-01-01T00:00:00'),
    end: new Date('2025-01-02T00:00:00'),
  },
  topUserLimit: 10,
}

const previousWindowStart = new Date('2024-12-31T00:00:00').getTime() / 1000

let updateFilters: (filters: UserChartsFilters) => void = () => undefined

function Harness() {
  const [filters, setFilters] = useState(initialFilters)
  updateFilters = setFilters
  return <AdminUsageAnalytics filters={filters} onFiltersChange={vi.fn()} />
}

function renderAnalytics() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const root = createRootRoute()
  const auth = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: () => null,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const dashboard = createRoute({
    getParentRoute: () => auth,
    path: '/dashboard',
    component: Harness,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs, dashboard])]),
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

describe('AdminUsageAnalytics', () => {
  test('queries with the parent range and exposes no local time control', async () => {
    getRankingMock.mockResolvedValue({ success: true, data: ranking })
    renderAnalytics()

    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(getRankingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        start_timestamp: Math.floor(
          initialFilters.range.start.getTime() / 1000
        ),
        end_timestamp: Math.floor(initialFilters.range.end.getTime() / 1000),
      })
    )

    // The time range now lives in the dashboard filter dialog, not here.
    expect(screen.queryByRole('button', { name: /~/ })).toBeNull()
    // The sort selector stays, but no quick-range preset tabs remain.
    expect(screen.getByRole('tab', { name: 'Cost' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Today' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '7 Days' })).toBeNull()
  })

  test('compares summary cards with the previous period and links to logs', async () => {
    getRankingMock.mockImplementation(async (params) => {
      if (params.start_timestamp === previousWindowStart) {
        return { success: true, data: previousRanking }
      }
      return { success: true, data: ranking }
    })
    renderAnalytics()

    expect(await screen.findByText('alice')).toBeInTheDocument()
    await waitFor(() => {
      expect(getRankingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          start_timestamp: previousWindowStart,
          end_timestamp:
            Math.floor(initialFilters.range.start.getTime() / 1000) - 1,
        })
      )
    })

    // Request count dropped from 2 to 1 in the comparison window.
    expect((await screen.findAllByText('↓50.0%')).length).toBeGreaterThan(0)
    // Each ranking row links to the usage logs for the user and window.
    const links = screen.getAllByRole('button', { name: 'View logs' })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]?.getAttribute('href')).toContain('username=alice')
    expect(links[0]?.getAttribute('href')).toContain(
      `startTime=${initialFilters.range.start.getTime()}`
    )
  })

  test('re-queries when the parent applies a new range', async () => {
    getRankingMock.mockResolvedValue({ success: true, data: ranking })
    renderAnalytics()
    await screen.findByText('alice')

    const nextRange = {
      start: new Date('2025-02-01T00:00:00'),
      end: new Date('2025-02-02T00:00:00'),
    }
    act(() => updateFilters({ ...initialFilters, range: nextRange }))

    await waitFor(() => {
      expect(getRankingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          start_timestamp: Math.floor(nextRange.start.getTime() / 1000),
          end_timestamp: Math.floor(nextRange.end.getTime() / 1000),
          page_size: 10,
        })
      )
    })
  })
})
