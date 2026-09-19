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
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { getLogAnalysis } from '@/features/dashboard/api'
import type { LogAnalysisData } from '@/features/dashboard/types'

import { ReliabilityPanel } from '../../reliability-panel'

vi.mock('@/features/dashboard/api', () => ({
  getLogAnalysis: vi.fn(),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: { error_log_enabled: true },
    loading: false,
    error: null,
  }),
}))

const getLogAnalysisMock = vi.mocked(getLogAnalysis)

const filters = {
  start_timestamp: new Date('2025-01-01T00:00:00'),
  end_timestamp: new Date('2025-01-01T01:00:00'),
}

const analysis: LogAnalysisData = {
  summary: {
    consume_count: 30,
    error_count: 3,
    quota: 100,
    tokens: 2000,
    success_rate: 30 / 33,
  },
  realtime: {
    minutes: 15,
    consume_count: 30,
    error_count: 3,
    quota: 100,
    tokens: 2000,
    active_users: 4,
    success_rate: 30 / 33,
    rpm: 2,
    tpm: 133.3,
  },
  bucket_seconds: 300,
  trend: [{ ts: 1700000000, consume: 10, error: 3 }],
  error_codes: [
    {
      error_code: 'bad_response_status_code',
      error_type: 'openai_error',
      status_code: 502,
      count: 3,
      sample: 'upstream failed',
    },
  ],
  error_models: [{ model_name: 'gpt-4o', count: 3 }],
  error_channels: [{ channel_id: 7, count: 3 }],
  channels: [
    {
      channel_id: 7,
      channel_name: 'alpha',
      status: 3,
      status_reason: 'upstream 502',
      status_time: 1700000100,
      consume_count: 30,
      error_count: 3,
      quota: 100,
      success_rate: 30 / 33,
      avg_latency_seconds: 2,
      p50_seconds: 1,
      p95_seconds: 5,
      p99_seconds: 10,
      max_latency_seconds: 12,
      auto_disabled_count: 2,
    },
  ],
  top_error_users: [{ user_id: 1, username: 'alice', count: 3 }],
  top_error_tokens: [{ token_id: 2, token_name: 'key-a', count: 3 }],
  error_logs_truncated: false,
}

function renderPanel() {
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
    component: () => <ReliabilityPanel filters={filters} />,
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
}

describe('ReliabilityPanel', () => {
  test('renders realtime, failure, and channel health data from the analysis API', async () => {
    getLogAnalysisMock.mockResolvedValue({ success: true, data: analysis })
    renderPanel()

    expect(await screen.findByText('Realtime')).toBeInTheDocument()
    expect(getLogAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({
        start_timestamp: Math.floor(filters.start_timestamp.getTime() / 1000),
        end_timestamp: Math.floor(filters.end_timestamp.getTime() / 1000),
        realtime_minutes: 15,
      })
    )

    // Realtime strip: 30 requests + 3 errors, 4 active users.
    expect(await screen.findByText('33')).toBeInTheDocument()
    expect(screen.getByText('9.1%')).toBeInTheDocument()
    expect(screen.getByText('Active users')).toBeInTheDocument()

    // Failure reasons and error breakdown.
    expect(screen.getByText('bad_response_status_code')).toBeInTheDocument()
    expect(screen.getByText('502')).toBeInTheDocument()
    expect(screen.getByText('upstream failed')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('key-a')).toBeInTheDocument()

    // Channel health leaderboard.
    expect(screen.getByText('Channel health')).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getAllByText('Auto Disabled').length).toBeGreaterThan(0)
    expect(screen.getByText(/upstream 502/)).toHaveAttribute(
      'title',
      expect.stringContaining('upstream 502')
    )

    // Trend bars and drill-down links carry the error type filter and model.
    const errorLinks = screen.getAllByRole('button', { name: 'View logs' })
    expect(errorLinks.length).toBeGreaterThan(0)
    const hrefs = errorLinks.map((link) => link.getAttribute('href') ?? '')
    expect(hrefs.some((href) => href.includes('model=gpt-4o'))).toBe(true)
    expect(hrefs.some((href) => href.includes('type=%5B%225%22%5D'))).toBe(true)
  })

  test('shows an empty state when the period has no errors', async () => {
    getLogAnalysisMock.mockResolvedValue({
      success: true,
      data: {
        ...analysis,
        realtime: { ...analysis.realtime, error_count: 0 },
        summary: { ...analysis.summary, error_count: 0 },
        trend: [],
        error_codes: [],
        error_models: [],
        error_channels: [],
        top_error_users: [],
        top_error_tokens: [],
      },
    })
    renderPanel()

    expect(await screen.findByText('Realtime')).toBeInTheDocument()
    expect(
      (await screen.findAllByText('No errors in this period')).length
    ).toBeGreaterThan(0)
  })
})
