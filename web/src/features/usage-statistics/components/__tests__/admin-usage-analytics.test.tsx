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
import i18next from 'i18next'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { UserChartsFilters } from '@/features/dashboard/types'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

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

const previousWindowStart = new Date('2024-12-31T00:00:00').getTime() / 1000 - 1

let queryClient: QueryClient
beforeEach(() => {
  const system = useSystemConfigStore.getState()
  system.setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
  })
  getRankingMock.mockResolvedValue({ success: true, data: ranking })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})
afterEach(async () => {
  await i18next.changeLanguage('en')
  for (const language of [
    'zhCN',
    'zhTW',
    'fr',
    'ru',
    'ja',
    'vi',
    'invalid-language',
  ]) {
    i18next.removeResourceBundle(language, 'translation')
  }
  queryClient?.clear()
  const system = useSystemConfigStore.getState()
  system.setConfig({ currency: DEFAULT_CURRENCY_CONFIG })
})

let updateFilters: (filters: UserChartsFilters) => void = () => undefined

function Harness() {
  const [filters, setFilters] = useState(initialFilters)
  updateFilters = setFilters
  return <AdminUsageAnalytics filters={filters} onFiltersChange={setFilters} />
}

function renderAnalytics() {
  queryClient = new QueryClient({
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
  test('queries with the parent range and exposes matching quick ranges', async () => {
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

    const quickRanges = screen.getByRole('group', { name: 'Quick Range' })
    expect(
      within(quickRanges).getByRole('button', { name: 'Today' })
    ).toBeVisible()
    expect(
      within(quickRanges).getByRole('button', { name: 'Last 24 hours' })
    ).toBeVisible()
    expect(
      within(quickRanges).getByRole('button', { name: '7 Days' })
    ).toBeVisible()
    expect(
      within(quickRanges).getByRole('button', { name: '30 Days' })
    ).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Cost' })).toBeInTheDocument()
  })

  test('quick ranges update the parent period and reset paging while retaining filters', async () => {
    getRankingMock.mockResolvedValue({
      success: true,
      data: { ...ranking, total: 25 },
    })
    const user = userEvent.setup()
    renderAnalytics()
    await screen.findByText('alice')
    await user.type(
      screen.getByRole('textbox', { name: 'Filter models' }),
      'model-a'
    )
    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await waitFor(() =>
      expect(getRankingMock).toHaveBeenCalledWith(
        expect.objectContaining({ p: 2 })
      )
    )
    await user.click(screen.getByRole('button', { name: 'Last 24 hours' }))
    await waitFor(() =>
      expect(getRankingMock).toHaveBeenCalledWith(
        expect.objectContaining({ p: 1, model_name: 'model-a' })
      )
    )
    const current = [...getRankingMock.mock.calls]
      .reverse()
      .find(
        ([params]) =>
          params.page_size === 10 &&
          params.model_name === 'model-a' &&
          params.end_timestamp - params.start_timestamp === 86400
      )?.[0]
    expect(current).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Last 24 hours' })
    ).toHaveAttribute('aria-pressed', 'true')
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    await user.click(screen.getByRole('button', { name: 'Today' }))
    await waitFor(() =>
      expect(getRankingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          start_timestamp: startOfToday.getTime() / 1000,
          page_size: 10,
          p: 1,
        })
      )
    )
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const today = [...getRankingMock.mock.calls]
      .reverse()
      .find(
        ([params]) =>
          params.page_size === 10 &&
          params.start_timestamp === startOfToday.getTime() / 1000
      )?.[0]
    const midnight = new Date((today?.end_timestamp ?? 0) * 1000)
    midnight.setHours(0, 0, 0, 0)
    expect(today?.start_timestamp).toBe(midnight.getTime() / 1000)
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

describe('user analytics dashboard presentation', () => {
  test('a single matching user has no comparison bar or percentage', async () => {
    renderAnalytics()
    await screen.findByText('alice')
    const list = screen.getByRole('region', { name: 'User Usage Ranking' })
    expect(within(list).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(list).queryByText('100.0%')).not.toBeInTheDocument()
    expect(
      within(list).getByText(
        'Only one user matches these filters; there is no comparison.'
      )
    ).toBeVisible()
  })

  test('global activity has its own scope and fetches without the selected filters', async () => {
    const user = userEvent.setup()
    renderAnalytics()
    await screen.findByText('alice')
    await user.type(
      screen.getByRole('textbox', { name: 'Filter users' }),
      'alice'
    )
    await user.type(screen.getByRole('textbox', { name: 'Channel ID' }), '7')
    await user.click(screen.getByRole('tab', { name: 'All-site activity' }))
    expect(await screen.findByText('Today (server time)')).toBeVisible()
    expect(
      screen.getByText('Site-wide · Today / rolling 7 / 30 days')
    ).toBeVisible()
    expect(
      screen.getByText(
        'All-site activity now, independent of the selected filters'
      )
    ).toBeVisible()
    expect(
      screen.queryByRole('textbox', { name: 'Filter users' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('group', { name: 'Quick Range' })
    ).not.toBeInTheDocument()
    expect(getRankingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p: 1,
        page_size: 1,
        username: undefined,
        model_name: undefined,
        channel: undefined,
      })
    )
    await user.click(screen.getByRole('tab', { name: 'User ranking' }))
    expect(screen.getByRole('textbox', { name: 'Filter users' })).toHaveValue(
      'alice'
    )
    expect(screen.getByRole('textbox', { name: 'Channel ID' })).toHaveValue('7')
  })

  test('metric definitions explain refund-only users, log counts, cache charges and refund timing', async () => {
    const user = userEvent.setup()
    renderAnalytics()
    await screen.findByText('alice')
    const help = screen.getByRole('button', {
      name: 'Metric definition: Users in period',
    })
    await user.hover(help)
    expect(
      await screen.findByText(
        'Distinct users with consumption or refund records in the selected period and filters. Users with only refunds are included.'
      )
    ).toBeVisible()
    await user.unhover(help)
    await user.click(screen.getByRole('tab', { name: 'Metric definitions' }))
    const panel = screen.getByRole('tabpanel', { name: 'Metric definitions' })
    expect(panel).toHaveTextContent('including billed cache charges')
    expect(panel).toHaveTextContent('Refunds use their own record time')
    expect(panel).toHaveTextContent('not unique successful API calls')
    expect(panel).toHaveTextContent(
      'Retries count only when a consumption record is written'
    )
    expect(panel).toHaveTextContent('Refunds change spend, not token totals')
  })

  test('uses summary cards and ranks shares against all users rather than this page', async () => {
    getRankingMock.mockResolvedValue({
      success: true,
      data: {
        ...ranking,
        total: 25,
        summary: {
          ...aggregate,
          user_cost: 100,
          request_count: 10,
          total_tokens: 150,
        },
      },
    })
    renderAnalytics()
    await screen.findByText('alice')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      within(
        screen.getByRole('region', { name: 'Users in period' })
      ).getAllByText('25').length
    ).toBeGreaterThan(0)
    const list = screen.getByRole('region', { name: 'User Usage Ranking' })
    expect(
      within(list).getByRole('progressbar', { name: 'alice' })
    ).toHaveAttribute('aria-valuenow', '20')
    await userEvent.click(screen.getByRole('tab', { name: 'Token breakdown' }))
    expect(
      screen.getByText(
        'Cache tokens are included in input; reasoning tokens are included in output.'
      )
    ).toBeInTheDocument()
  })

  test('switching ranking metric reorders users and their share bars', async () => {
    const beta = {
      ...ranking.items[0],
      user_id: 2,
      username: 'beta',
      total_tokens: 135,
    }
    getRankingMock.mockImplementation(async (params) => ({
      success: true,
      data: {
        ...ranking,
        total: 2,
        summary: { ...aggregate, total_tokens: 150 },
        items:
          params.sort_by === 'total_tokens'
            ? [beta, ranking.items[0]]
            : [ranking.items[0], beta],
      },
    }))
    const user = userEvent.setup()
    renderAnalytics()
    await screen.findByText('alice')
    await user.click(screen.getByRole('tab', { name: 'Tokens' }))
    await waitFor(() => {
      const rows = within(
        screen.getByRole('region', { name: 'User Usage Ranking' })
      ).getAllByRole('listitem')
      expect(
        within(rows[0]).getByRole('button', { name: 'beta' })
      ).toBeInTheDocument()
      expect(within(rows[0]).getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '90'
      )
    })
    expect(screen.getByRole('tab', { name: 'Tokens' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  test('paging uses global ranks and a new parent range resets to the first page', async () => {
    getRankingMock.mockImplementation(async (params) => ({
      success: true,
      data: {
        ...ranking,
        total: 25,
        items:
          params.p === 2
            ? [{ ...ranking.items[0], user_id: 2, username: 'beta' }]
            : ranking.items,
      },
    }))
    const user = userEvent.setup()
    renderAnalytics()
    await screen.findByText('alice')
    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await screen.findByText('beta')
    expect(
      within(
        screen.getByRole('region', { name: 'User Usage Ranking' })
      ).getByText('11')
    ).toBeInTheDocument()
    const nextRange = {
      start: new Date('2025-02-01T00:00:00'),
      end: new Date('2025-02-02T00:00:00'),
    }
    act(() => updateFilters({ ...initialFilters, range: nextRange }))
    await screen.findByText('alice')
    expect(getRankingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        start_timestamp: nextRange.start.getTime() / 1000,
        p: 1,
        page_size: 10,
      })
    )
    act(() => updateFilters(initialFilters))
    await screen.findByText('alice')
    expect(screen.queryByText('beta')).not.toBeInTheDocument()
  })

  test('changing a filter after paging resets the page and preserves model and channel in logs', async () => {
    getRankingMock.mockResolvedValue({
      success: true,
      data: { ...ranking, total: 25 },
    })
    const user = userEvent.setup()
    renderAnalytics()
    await screen.findByText('alice')
    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await waitFor(() =>
      expect(getRankingMock).toHaveBeenCalledWith(
        expect.objectContaining({ p: 2 })
      )
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Filter models' }),
      'model-a'
    )
    await user.type(screen.getByRole('textbox', { name: 'Channel ID' }), '7')
    await waitFor(() =>
      expect(getRankingMock).toHaveBeenCalledWith(
        expect.objectContaining({ p: 1, model_name: 'model-a', channel: 7 })
      )
    )
    const link = await screen.findByRole('button', { name: 'View logs' })
    expect(link.getAttribute('href')).toContain('model=model-a')
    const search = new URL(
      link.getAttribute('href') ?? '',
      'https://example.com'
    ).searchParams
    expect(JSON.parse(search.get('channel') ?? 'null')).toBe('7')
    expect(link.getAttribute('href')).toContain('username=alice')
  })

  test('a previous-period failure leaves current values visible without a false comparison', async () => {
    getRankingMock.mockImplementation(async (params) =>
      params.start_timestamp === previousWindowStart
        ? { success: false, message: 'comparison unavailable' }
        : { success: true, data: ranking }
    )
    renderAnalytics()
    await screen.findByText('alice')
    expect(
      screen.queryByText('Failed to load usage details')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTitle('Compared with the previous period')
    ).not.toBeInTheDocument()
  })

  test('an empty period shows zero summaries and retains current all-site activity', async () => {
    getRankingMock.mockResolvedValue({
      success: true,
      data: {
        ...ranking,
        items: [],
        total: 0,
        summary: {
          ...aggregate,
          request_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          user_cost: 0,
        },
      },
    })
    renderAnalytics()
    await screen.findByText('No usage data')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      within(
        screen.getByRole('region', { name: 'Consumption records' })
      ).getAllByText('0').length
    ).toBeGreaterThan(0)
    await userEvent.click(
      screen.getByRole('tab', { name: 'All-site activity' })
    )
    expect(await screen.findByText('Today (server time)')).toBeVisible()
    expect(
      within(
        screen.getByRole('region', { name: 'Current user activity' })
      ).getByText('3')
    ).toBeInTheDocument()
  })

  test('refunded costs do not create invalid shares or hide negative amounts', async () => {
    getRankingMock.mockResolvedValue({
      success: true,
      data: {
        ...ranking,
        total: 2,
        summary: { ...aggregate, user_cost: -500000 },
        items: [{ ...ranking.items[0], user_cost: -500000 }],
      },
    })
    renderAnalytics()
    await screen.findByText('alice')
    expect(
      within(
        screen.getByRole('region', { name: 'User Usage Ranking' })
      ).getByRole('progressbar')
    ).toHaveAttribute('aria-valuenow', '0')
    expect(
      within(screen.getByRole('region', { name: 'User Cost' })).getByText('-$1')
    ).toBeInTheDocument()
  })

  test('a failed current request hides totals and retries successfully', async () => {
    getRankingMock.mockResolvedValue({
      success: false,
      message: 'stats unavailable',
    })
    const user = userEvent.setup()
    renderAnalytics()
    await screen.findByText('Failed to load usage details')
    expect(
      within(screen.getByRole('region', { name: 'User Cost' })).getByText('--')
    ).toBeInTheDocument()
    getRankingMock.mockResolvedValue({ success: true, data: ranking })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('alice')
  })

  test('a new range does not show the old values while its request is pending', async () => {
    renderAnalytics()
    await screen.findByText('alice')
    getRankingMock.mockImplementation(() => new Promise(() => undefined))
    act(() =>
      updateFilters({
        ...initialFilters,
        range: {
          start: new Date('2025-02-01T00:00:00'),
          end: new Date('2025-02-02T00:00:00'),
        },
      })
    )
    await waitFor(() =>
      expect(screen.queryByText('alice')).not.toBeInTheDocument()
    )
    expect(
      within(screen.getByRole('region', { name: 'User Cost' })).queryByTitle(
        'Compared with the previous period'
      )
    ).not.toBeInTheDocument()
  })
})

test.each([
  ['en', '12,345'],
  ['zhCN', '12,345'],
  ['zhTW', '12,345'],
  ['fr', '12\u202f345'],
  ['ru', '12\u00a0345'],
  ['ja', '12,345'],
  ['vi', '12.345'],
  ['invalid-language', '12,345'],
])(
  'switching to %s updates formatted values using a valid Intl locale',
  async (language, expected) => {
    getRankingMock.mockResolvedValue({
      success: true,
      data: {
        ...ranking,
        summary: { ...aggregate, total_tokens: 12345 },
        items: [{ ...ranking.items[0], total_tokens: 12345 }],
      },
    })
    renderAnalytics()
    await screen.findByText('alice')
    i18next.addResourceBundle(language, 'translation', {
      'Total Tokens': 'Total Tokens',
    })
    await act(async () => {
      await i18next.changeLanguage(language)
    })
    expect(
      within(
        screen.getByRole('region', { name: 'User Usage Ranking' })
      ).getByTitle(expected, { normalizer: (value) => value })
    ).toBeVisible()
  }
)

test('ranking controls retain focus and the selected metric while the new ranking is loading', async () => {
  const user = userEvent.setup()
  renderAnalytics()
  await screen.findByText('alice')
  getRankingMock.mockImplementation(() => new Promise(() => undefined))
  await user.click(screen.getByRole('tab', { name: 'Tokens' }))
  const tab = screen.getByRole('tab', { name: 'Tokens' })
  expect(tab).toHaveAttribute('aria-selected', 'true')
  expect(tab).toHaveFocus()
  expect(screen.queryByText('alice')).not.toBeInTheDocument()
})
