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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const initialRange = {
  start: new Date('2025-01-01T00:00:00'),
  end: new Date('2025-01-02T00:00:00'),
}

function renderAnalytics() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  function Harness() {
    const [filters, setFilters] = useState<UserChartsFilters>({
      timeGranularity: 'hour',
      range: initialRange,
      topUserLimit: 10,
    })
    return (
      <AdminUsageAnalytics
        filters={filters}
        onFiltersChange={(next) => setFilters(next)}
      />
    )
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  )
}

describe('AdminUsageAnalytics', () => {
  test('uses the parent range as the only time-range control', async () => {
    getRankingMock.mockResolvedValue({ success: true, data: ranking })
    renderAnalytics()

    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(getRankingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        start_timestamp: Math.floor(initialRange.start.getTime() / 1000),
        end_timestamp: Math.floor(initialRange.end.getTime() / 1000),
      })
    )

    // The sort selector stays, but no quick-range preset tabs remain.
    expect(screen.getByRole('tab', { name: 'Cost' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Today' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '7 Days' })).toBeNull()
  })

  test('re-queries with the picked range and keeps it in parent filters', async () => {
    getRankingMock.mockResolvedValue({ success: true, data: ranking })
    renderAnalytics()
    await screen.findByText('alice')

    fireEvent.click(screen.getByRole('button', { name: /~/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Today' }))

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    await waitFor(() => {
      const lastCall = getRankingMock.mock.calls.at(-1)?.[0]
      expect(lastCall?.start_timestamp).toBe(
        Math.floor(todayStart.getTime() / 1000)
      )
    })
  })
})
