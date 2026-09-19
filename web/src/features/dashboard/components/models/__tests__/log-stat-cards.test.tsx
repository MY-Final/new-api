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
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getUserQuotaDates } from '@/features/dashboard/api'
import { useAuthStore } from '@/stores/auth-store'

import { LogStatCards } from '../log-stat-cards'

vi.mock('@/features/dashboard/api', () => ({
  getUserQuotaDates: vi.fn(),
}))

const getUserQuotaDatesMock = vi.mocked(getUserQuotaDates)

const currentRangeStart = new Date('2025-01-01T00:00:00')
const currentRangeEnd = new Date('2025-01-02T00:00:00')
const previousRangeStart = new Date(currentRangeStart.getTime() - 86_400_000)

function renderCards() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <LogStatCards
        filters={{
          start_timestamp: currentRangeStart,
          end_timestamp: currentRangeEnd,
          time_granularity: 'hour',
        }}
        onDataUpdate={vi.fn()}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'admin',
    role: 10,
    quota: 0,
    used_quota: 0,
    request_count: 0,
  })
})

describe('LogStatCards', () => {
  test('shows period-over-period deltas from the previous window', async () => {
    getUserQuotaDatesMock.mockImplementation(async (params) => {
      const isPrevious =
        params.start_timestamp ===
        Math.floor(previousRangeStart.getTime() / 1000)
      const scale = isPrevious ? 0.5 : 1
      return {
        success: true,
        data: [
          {
            created_at: params.start_timestamp,
            model_name: 'gpt-4o',
            count: Math.round(10 * scale),
            quota: Math.round(100 * scale),
            token_used: Math.round(1000 * scale),
          },
        ],
      }
    })
    renderCards()

    expect(await screen.findByText('Total Count')).toBeInTheDocument()
    expect(getUserQuotaDatesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        start_timestamp: Math.floor(previousRangeStart.getTime() / 1000),
      }),
      true
    )
    expect((await screen.findAllByText('↑100%')).length).toBeGreaterThan(0)
  })

  test('omits deltas when the previous window has no data', async () => {
    getUserQuotaDatesMock.mockImplementation(async (params) => {
      const isPrevious =
        params.start_timestamp ===
        Math.floor(previousRangeStart.getTime() / 1000)
      return {
        success: true,
        data: isPrevious
          ? []
          : [
              {
                created_at: params.start_timestamp,
                model_name: 'gpt-4o',
                count: 10,
                quota: 100,
                token_used: 1000,
              },
            ],
      }
    })
    renderCards()

    expect(await screen.findByText('Total Count')).toBeInTheDocument()
    expect(screen.queryByText('↑100%')).toBeNull()
    expect(screen.queryByText('↓50%')).toBeNull()
  })
})
