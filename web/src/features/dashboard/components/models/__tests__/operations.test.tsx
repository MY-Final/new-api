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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getPerfMetricsSummary } from '@/features/performance-metrics/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { getUserQuotaDates } from '../../../api'
import { DEFAULT_DASHBOARD_CHART_PREFERENCES } from '../../../constants'
import type { DashboardFilters } from '../../../types'
import { ModelDashboard } from '../model-dashboard'

vi.mock('../../../api', () => ({ getUserQuotaDates: vi.fn() }))
vi.mock('@/features/performance-metrics/api', () => ({
  getPerfMetricsSummary: vi.fn(),
}))

const start = new Date('2026-10-10T10:30:00Z')
const end = new Date('2026-10-11T10:30:00Z')
let client: QueryClient

beforeEach(() => {
  localStorage.clear()
  const auth = useAuthStore.getState().auth
  auth.setUser({ id: 1, username: 'member', role: 1, quota: 5000000 })
  const system = useSystemConfigStore.getState()
  system.setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(getUserQuotaDates).mockResolvedValue({
    success: true,
    data: [
      {
        created_at: 1791626400,
        model_name: 'cheap-frequent',
        quota: 500000,
        count: 100,
        token_used: 200,
      },
      {
        created_at: 1791626400,
        model_name: 'expensive-rare',
        quota: 1500000,
        count: 1,
        token_used: 100,
      },
    ],
  })
  vi.mocked(getPerfMetricsSummary).mockResolvedValue({
    success: true,
    data: {
      window_start: Math.floor(start.getTime() / 1000),
      window_end: Math.floor(end.getTime() / 1000),
      summary: { success_rate: 92, avg_latency_ms: 1500, avg_tps: 20 },
      models: [
        {
          model_name: 'healthy',
          success_rate: 100,
          avg_latency_ms: 1000,
          avg_tps: 20,
        },
        {
          model_name: 'needs-attention',
          success_rate: 74,
          avg_latency_ms: 2000,
          avg_tps: 10,
        },
      ],
    },
  })
})
afterEach(() => {
  client.clear()
  useAuthStore.getState().auth.reset()
  const system = useSystemConfigStore.getState()
  system.setConfig({ currency: DEFAULT_CURRENCY_CONFIG })
  localStorage.clear()
})

function renderDashboard(isAdmin = true) {
  function Page() {
    const [filters, setFilters] = useState<DashboardFilters>({
      start_timestamp: start,
      end_timestamp: end,
      time_granularity: 'hour',
      username: isAdmin ? 'alice' : undefined,
    })
    return (
      <ModelDashboard
        isAdmin={isAdmin}
        filters={filters}
        preferences={DEFAULT_DASHBOARD_CHART_PREFERENCES}
        onFilterChange={setFilters}
        refetchInterval={false}
      />
    )
  }
  const root = createRootRoute()
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: Page,
  })
  const logs = createRoute({
    getParentRoute: () => root,
    path: '/usage-logs/$section',
    component: () => null,
  })
  const router = createRouter({
    routeTree: root.addChildren([index, logs]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('operations dashboard', () => {
  test('shows live personal balance independently of the selected usage range', async () => {
    const user = userEvent.setup()
    renderDashboard(false)
    const balance = await screen.findByRole('region', {
      name: 'Current Balance',
    })
    expect(within(balance).getByText('$10')).toBeVisible()
    expect(
      within(balance).getByRole('link', { name: 'Go to Wallet' })
    ).toHaveAttribute('href', '/wallet')
    await user.click(screen.getByRole('button', { name: '7 Days' }))
    expect(within(balance).getByText('$10')).toBeVisible()
    const auth = useAuthStore.getState().auth
    act(() => {
      auth.setUser({ id: 1, username: 'member', role: 1, quota: 2500000 })
    })
    expect(within(balance).getByText('$5')).toBeVisible()
  })

  test('puts personal trend before model usage and preserves the range in the logs shortcut', async () => {
    renderDashboard(false)
    const ranking = await screen.findByRole('region', {
      name: 'My model usage',
    })
    const trend = screen.getByRole('region', { name: 'Consumption Trend' })
    expect(
      trend.compareDocumentPosition(ranking) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByRole('region', { name: 'Period consumption' })
    ).toBeVisible()
    const logs = await screen.findByRole('link', { name: 'Usage Logs' })
    const search = new URL(logs.getAttribute('href') ?? '', 'http://localhost')
      .searchParams
    expect(search.get('startTime')).toBe(String(start.getTime()))
    expect(search.get('endTime')).toBe(String(end.getTime()))
    expect(search.get('username')).toBeNull()
    expect(screen.getByRole('link', { name: 'API Keys' })).toHaveAttribute(
      'href',
      '/keys'
    )
  })

  test('labels a negative personal balance as debt while leaving empty usage empty', async () => {
    const auth = useAuthStore.getState().auth
    auth.setUser({ id: 1, username: 'member', role: 1, quota: -500000 })
    vi.mocked(getUserQuotaDates).mockResolvedValue({ success: true, data: [] })
    renderDashboard(false)
    const debt = await screen.findByRole('region', { name: 'Debt' })
    expect(within(debt).getByText('$1')).toBeVisible()
    expect(within(debt).getByText('Recharge to settle debt')).toBeVisible()
    expect(await screen.findAllByText('No usage data')).toHaveLength(2)
    expect(getPerfMetricsSummary).not.toHaveBeenCalled()
  })

  test('keeps an unavailable balance unknown instead of showing zero', async () => {
    useAuthStore.getState().auth.setUser({ id: 1, username: 'member', role: 1 })
    renderDashboard(false)
    const balance = await screen.findByRole('region', {
      name: 'Current Balance',
    })
    expect(within(balance).getByText('--')).toBeVisible()
    expect(within(balance).queryByText('$0')).not.toBeInTheDocument()
  })

  test('shows the new account usage after switching users instead of reusing the previous cache', async () => {
    renderDashboard(false)
    const requests = await screen.findByRole('region', { name: 'Requests' })
    expect(await within(requests).findByText('101')).toBeVisible()
    vi.mocked(getUserQuotaDates).mockResolvedValue({
      success: true,
      data: [
        {
          created_at: 1791626400,
          model_name: 'second-account',
          quota: 500000,
          count: 4,
          token_used: 50,
        },
      ],
    })
    const auth = useAuthStore.getState().auth
    act(() => {
      auth.setUser({ id: 2, username: 'second', role: 1, quota: 500000 })
    })
    expect(await within(requests).findByText('4')).toBeVisible()
    expect(within(requests).queryByText('101')).not.toBeInTheDocument()
    expect(
      await screen.findByRole('link', { name: 'second-account' })
    ).toBeVisible()
  })

  test('ranks by cost first, switches requests and preserves the user in log drilldowns', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByRole('link', { name: 'expensive-rare' })
    const panel = screen.getByRole('region', { name: 'Model Ranking' })
    const links = within(panel).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'expensive-rare',
      'cheap-frequent',
    ])
    const href = links[0].getAttribute('href')
    expect(href).toBeTruthy()
    const search = new URL(href ?? '', 'http://localhost').searchParams
    expect(search.get('username')).toBe('alice')
    expect(search.get('model')).toBe('expensive-rare')
    const requestTab = within(
      screen.getByRole('tablist', { name: 'Model ranking metric' })
    ).getByRole('tab', { name: 'Requests' })
    await user.click(requestTab)
    expect(within(panel).getAllByRole('link')[0]).toHaveTextContent(
      'cheap-frequent'
    )
    expect(requestTab).toHaveAttribute('aria-selected', 'true')
  })

  test('shows low success rates first and drills into the actual performance window', async () => {
    renderDashboard()
    const first = await screen.findByRole('link', {
      name: 'View failed requests for needs-attention',
    })
    const links = screen.getAllByRole('link', {
      name: /View failed requests for/,
    })
    expect(links[0]).toBe(first)
    const search = new URL(first.getAttribute('href') ?? '', 'http://localhost')
      .searchParams
    expect(search.get('model')).toBe('needs-attention')
    expect(search.get('startTime')).toBe(String(start.getTime()))
    expect(search.get('endTime')).toBe(String(end.getTime()))
    expect(search.get('username')).toBeNull()
    expect(search.get('type')).toContain('5')
    expect(
      screen.getByText('All-site performance · last 24 hours')
    ).toBeVisible()
  })

  test('keeps scope while changing the range and compares nonoverlapping hour buckets', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('Model Ranking')
    const requests = vi
      .mocked(getUserQuotaDates)
      .mock.calls.map(([params]) => params)
    const previous = requests.find(
      (params) => params.end_timestamp < Math.floor(start.getTime() / 1000)
    )
    expect(previous?.end_timestamp).toBe(
      Math.floor(start.getTime() / 3600000) * 3600 - 1
    )
    await user.click(screen.getByRole('button', { name: '7 Days' }))
    expect(screen.getByRole('button', { name: '7 Days' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(vi.mocked(getUserQuotaDates)).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alice', default_time: 'day' }),
      true
    )
  })

  test('uses self statistics and hides site performance for ordinary users', async () => {
    renderDashboard(false)
    await screen.findByRole('region', { name: 'My model usage' })
    expect(getUserQuotaDates).toHaveBeenCalledWith(expect.anything(), false)
    expect(getPerfMetricsSummary).not.toHaveBeenCalled()
    expect(screen.queryByText('Models to watch')).not.toBeInTheDocument()
  })

  test('marks the 30-day range selected and keeps both self queries within the API limit', async () => {
    const user = userEvent.setup()
    renderDashboard(false)
    await screen.findByRole('region', { name: 'My model usage' })
    await user.click(screen.getByRole('button', { name: '30 Days' }))
    expect(screen.getByRole('button', { name: '30 Days' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const ranges = vi
      .mocked(getUserQuotaDates)
      .mock.calls.slice(-2)
      .map(([params]) => params)
    expect(ranges).toHaveLength(2)
    for (const range of ranges) {
      expect(range.end_timestamp - range.start_timestamp).toBeLessThanOrEqual(
        30 * 86400
      )
    }
    expect(Math.floor(ranges[1].end_timestamp / 3600)).toBeLessThan(
      Math.floor(ranges[0].start_timestamp / 3600)
    )
  })

  test('switches the trend metric with keyboard controls and updates its total', async () => {
    const user = userEvent.setup()
    renderDashboard(false)
    await screen.findByRole('link', { name: 'expensive-rare' })
    const trend = screen.getByRole('region', { name: 'Consumption Trend' })
    const tabs = within(trend).getByRole('tablist', { name: 'Trend metric' })
    const cost = within(tabs).getByRole('tab', { name: 'Cost' })
    cost.focus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(within(tabs).getByRole('tab', { name: 'Requests' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(within(trend).getByText('Total: 101 · Hour')).toBeVisible()
  })

  test('expands long model names and retains shares across all models', async () => {
    const user = userEvent.setup()
    const longName =
      'very-long-provider/model-name-with-a-long-version-and-region-suffix'
    vi.mocked(getUserQuotaDates).mockResolvedValue({
      success: true,
      data: [
        {
          created_at: 1791626400,
          model_name: longName,
          quota: 500000,
          count: 1,
          token_used: 10,
        },
        ...['b', 'c', 'd', 'e', 'f'].map((model_name) => ({
          created_at: 1791626400,
          model_name,
          quota: 100000,
          count: 1,
          token_used: 1,
        })),
      ],
    })
    renderDashboard(false)
    await screen.findByRole('link', { name: longName })
    const panel = screen.getByRole('region', { name: 'My model usage' })
    expect(within(panel).getAllByRole('link')).toHaveLength(5)
    expect(within(panel).getByText('50%')).toBeVisible()
    const expand = within(panel).getByRole('button', {
      name: 'View all models',
    })
    await user.click(expand)
    expect(expand).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getAllByRole('link')).toHaveLength(6)
    expect(within(panel).getByText('50%')).toBeVisible()
  })

  test('keeps success unknown when performance is empty', async () => {
    vi.mocked(getPerfMetricsSummary).mockResolvedValue({
      success: true,
      data: { models: [], summary: null },
    })
    renderDashboard()
    await screen.findByText('No performance data available')
    const card = screen.getByRole('region', { name: 'Success rate' })
    expect(within(card).getByText('—')).toBeVisible()
    expect(within(card).queryByText('0.00%')).not.toBeInTheDocument()
  })

  test('recovers from a failed performance response with retry', async () => {
    vi.mocked(getPerfMetricsSummary).mockResolvedValueOnce({
      success: false,
      data: { models: [], summary: null },
    })
    const user = userEvent.setup()
    renderDashboard()
    const panel = await screen.findByRole('region', { name: 'Models to watch' })
    await user.click(
      await within(panel).findByRole('button', { name: 'Retry' })
    )
    await waitFor(() =>
      expect(
        within(panel).getByRole('link', {
          name: 'View failed requests for needs-attention',
        })
      ).toBeVisible()
    )
  })

  test('shows retry instead of an empty chart on a failed statistics response', async () => {
    vi.mocked(getUserQuotaDates).mockResolvedValue({ success: false, data: [] })
    renderDashboard(false)
    expect(await screen.findByText('Failed to load statistics')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
    expect(screen.queryByText('No usage data')).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Current Balance' })).getByText(
        '$10'
      )
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Usage Logs' })).toBeVisible()
  })
})
