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
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuotaDataItem } from '@/features/dashboard/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { OverviewDashboard } from '../overview-dashboard'

const storageKey = 'dashboard_overview_setup_guide_expanded'
let client: QueryClient
let keyLookupError: Error | null
let usageData: QuotaDataItem[]
let usageFails: boolean
let contentEnabled: boolean
let uptimeEnabled: boolean

beforeEach(() => {
  window.localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'dashboard-user',
    role: 1,
    quota: 1000000,
    used_quota: 1000,
    request_count: 1,
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  keyLookupError = null
  usageData = []
  usageFails = false
  contentEnabled = false
  uptimeEnabled = false
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    switch (url) {
      case '/api/token/?p=1&size=10':
        if (keyLookupError) throw keyLookupError
        return {
          data: {
            success: true,
            data: {
              items: [{ id: 1, name: 'App key', key: 'masked', status: 1 }],
            },
          },
        }
      case '/api/status':
        return {
          data: {
            data: {
              api_info_enabled: contentEnabled,
              announcements_enabled: contentEnabled,
              faq_enabled: contentEnabled,
              uptime_kuma_enabled: uptimeEnabled,
              announcements: [{ id: 1, content: 'Latest platform update' }],
              faq: [
                {
                  id: 'help',
                  question: 'How do I get started?',
                  answer: 'Create a key.',
                },
              ],
              api_info: [
                {
                  url: 'https://api.example.com',
                  route: '/v1',
                  description: 'API gateway',
                  color: 'blue',
                },
              ],
            },
          },
        }
      case '/api/user/models':
        return { data: { success: true, data: ['gpt-4o-mini'] } }
      case '/api/data/self':
      case '/api/data':
        return { data: { success: !usageFails, data: usageData } }
      case '/api/perf-metrics/summary':
        return {
          data: {
            success: true,
            data: {
              summary: { success_rate: 96, avg_latency_ms: 1500, avg_tps: 20 },
              models: [
                {
                  model_name: 'needs-attention',
                  success_rate: 75,
                  avg_latency_ms: 1800,
                  avg_tps: 15,
                },
              ],
            },
          },
        }
      case '/api/uptime/status':
        return {
          data: {
            success: true,
            data: [
              {
                categoryName: 'Production',
                monitors: [
                  {
                    name: 'production-provider-with-a-long-model-version-and-region',
                    status: 0,
                    uptime: 0.98,
                    group: 'Extended models',
                  },
                  { name: 'Main API', status: 1, uptime: 1 },
                ],
              },
            ],
          },
        }
      default:
        throw new Error(`Unexpected dashboard request: ${url}`)
    }
  })
})

describe('overview usage and content', () => {
  it('shows the selected period usage before support content and keeps personal balance separate', async () => {
    usageData = [
      {
        created_at: Math.floor(Date.now() / 1000),
        model_name: 'active-model',
        quota: 500000,
        count: 42,
        token_used: 1000,
      },
    ]
    contentEnabled = true
    await renderOverview()
    const requests = await screen.findByRole('region', { name: 'Requests' })
    expect(await within(requests).findByText('42')).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'Current Balance' })
    ).toBeVisible()
    expect(
      screen.getByText('Current balance, independent of the selected period')
    ).toBeVisible()
    const trend = screen.getByRole('region', { name: 'Consumption Trend' })
    const announcement = await screen.findByText('Latest platform update')
    expect(
      trend.compareDocumentPosition(announcement) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      vi.mocked(api.get).mock.calls.some(([url]) => url === '/api/data')
    ).toBe(false)
    expect(
      vi
        .mocked(api.get)
        .mock.calls.some(([url]) => url === '/api/perf-metrics/summary')
    ).toBe(false)
  })

  it('loads site-wide usage and model health for an administrator instead of their personal totals', async () => {
    usageData = [
      {
        created_at: Math.floor(Date.now() / 1000),
        model_name: 'site-model',
        count: 123,
        quota: 500000,
      },
    ]
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'admin',
      role: 10,
      quota: 1000000,
      request_count: 1,
    })
    await renderOverview()
    const requests = await screen.findByRole('region', { name: 'Requests' })
    expect(await within(requests).findByText('123')).toBeVisible()
    expect(screen.getByText('All users')).toBeVisible()
    expect(
      await screen.findByRole('link', {
        name: 'View failed requests for needs-attention',
      })
    ).toBeVisible()
    expect(
      screen.queryByRole('region', { name: 'Current Balance' })
    ).not.toBeInTheDocument()
    expect(
      vi.mocked(api.get).mock.calls.some(([url]) => url === '/api/data')
    ).toBe(true)
    expect(
      vi.mocked(api.get).mock.calls.some(([url]) => url === '/api/data/self')
    ).toBe(false)
  })

  it('changes all usage modules to a quick range without changing the balance', async () => {
    const user = userEvent.setup()
    await renderOverview()
    const quick = await screen.findByRole('group', { name: 'Quick Range' })
    await user.click(
      within(quick).getByRole('button', { name: 'Last 24 hours' })
    )
    expect(
      within(quick).getByRole('button', { name: 'Last 24 hours' })
    ).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() =>
      expect(
        vi.mocked(api.get).mock.calls.some(([url, config]) => {
          const params = config?.params
          return (
            url === '/api/data/self' &&
            params.end_timestamp - params.start_timestamp === 86400
          )
        })
      ).toBe(true)
    )
    expect(
      screen.getByRole('region', { name: 'Current Balance' })
    ).toBeVisible()
  })

  it('shows the new account usage after the signed-in user changes', async () => {
    usageData = [
      {
        created_at: Math.floor(Date.now() / 1000),
        model_name: 'first-account',
        count: 42,
      },
    ]
    await renderOverview()
    const requests = await screen.findByRole('region', { name: 'Requests' })
    expect(await within(requests).findByText('42')).toBeVisible()
    usageData = [
      {
        created_at: Math.floor(Date.now() / 1000),
        model_name: 'second-account',
        count: 7,
      },
    ]
    act(() =>
      useAuthStore
        .getState()
        .auth.setUser({ id: 2, username: 'second', role: 1, quota: 500000 })
    )
    expect(await within(requests).findByText('7')).toBeVisible()
    expect(within(requests).queryByText('42')).not.toBeInTheDocument()
    expect(
      await screen.findByRole('link', { name: 'second-account' })
    ).toBeVisible()
  })

  it('shows monitor names and current online counts independently of historical uptime', async () => {
    uptimeEnabled = true
    await renderOverview()
    expect(await screen.findByText('1 of 2 monitors online')).toBeVisible()
    expect(
      screen.getByText(
        'production-provider-with-a-long-model-version-and-region'
      )
    ).toBeVisible()
    expect(screen.getByText('Offline · Extended models')).toBeVisible()
    expect(screen.getByText('98.00%')).toBeVisible()
  })

  it.each([1, 10])(
    'shows announcements, FAQ and access information together for role %s',
    async (role) => {
      contentEnabled = true
      const user = userEvent.setup()
      useAuthStore.getState().auth.setUser({
        id: 1,
        username: 'dashboard-user',
        role,
        quota: 1000000,
        request_count: 1,
      })
      await renderOverview()
      expect(await screen.findByText('Latest platform update')).toBeVisible()
      expect(screen.getByText('https://api.example.com')).toBeVisible()
      const question = screen.getByRole('button', {
        name: 'How do I get started?',
      })
      expect(question).toBeVisible()
      question.focus()
      await user.keyboard('{Enter}')
      expect(await screen.findByText('Create a key.')).toBeVisible()
      expect(question).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Latest platform update')).toBeVisible()
      expect(screen.getByText('https://api.example.com')).toBeVisible()
      expect(
        screen.queryByRole('tablist', { name: 'Overview information' })
      ).not.toBeInTheDocument()
    }
  )

  it('keeps disabled information panels hidden', async () => {
    await renderOverview()
    await screen.findByRole('button', { name: 'Setup guide' })
    expect(screen.queryByText('Latest platform update')).not.toBeInTheDocument()
    expect(screen.queryByText('How do I get started?')).not.toBeInTheDocument()
    expect(
      screen.queryByText('https://api.example.com')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Service availability by monitor')
    ).not.toBeInTheDocument()
  })

  it('shows unknown metrics and retry on usage failure instead of fabricated zero usage', async () => {
    usageFails = true
    const user = userEvent.setup()
    await renderOverview()
    await screen.findByText('Failed to load statistics')
    expect(
      within(screen.getByRole('region', { name: 'Requests' })).getByText('--')
    ).toBeVisible()
    usageFails = false
    usageData = [
      {
        created_at: Math.floor(Date.now() / 1000),
        model_name: 'recovered',
        count: 7,
      },
    ]
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await within(screen.getByRole('region', { name: 'Requests' })).findByText(
        '7'
      )
    ).toBeVisible()
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  window.localStorage.clear()
})

async function renderOverview() {
  const router = createRouter({
    routeTree: createRootRoute({ component: OverviewDashboard }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('overview setup guide', () => {
  it('shows usage and persistent quick actions while keeping the completed guide collapsed', async () => {
    await renderOverview()

    const toggle = await screen.findByRole('button', { name: 'Setup guide' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getAllByRole('heading').map((heading) => heading.textContent)
    ).toEqual(['Overview', 'Usage at a glance'])
    expect(screen.queryByText('Setup guide complete')).not.toBeInTheDocument()
    expect(screen.queryByText('Setup progress: 3/3')).not.toBeInTheDocument()
    const actions = screen.getByRole('navigation', { name: 'Quick actions' })
    for (const name of ['API Keys', 'Usage Logs', 'Pricing']) {
      expect(within(actions).getByRole('button', { name })).toBeVisible()
    }
    expect(
      within(actions).queryByRole('button', { name: 'Channels' })
    ).not.toBeInTheDocument()
    const panel = document.getElementById(
      toggle.getAttribute('aria-controls') ?? ''
    )
    expect(panel).toBeInTheDocument()
    expect(panel).not.toBeVisible()
  })

  it('toggles the completed guide with the keyboard and restores focus after hiding it', async () => {
    const user = userEvent.setup()
    await renderOverview()
    const toggle = await screen.findByRole('button', { name: 'Setup guide' })

    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    ).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: 'Build on your API gateway in minutes',
      })
    ).toBeVisible()
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^API Keys/ })).toHaveLength(
        2
      )
    )

    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Hide setup guide' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  it('restores the completed guide preference after remounting', async () => {
    const user = userEvent.setup()
    const first = await renderOverview()
    await user.click(await screen.findByRole('button', { name: 'Setup guide' }))
    first.unmount()

    const second = await renderOverview()
    expect(
      await screen.findByRole('button', { name: 'Setup guide' })
    ).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Hide setup guide' }))
    second.unmount()

    await renderOverview()
    expect(
      await screen.findByRole('button', { name: 'Setup guide' })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Setup guide complete')).not.toBeInTheDocument()
  })

  it('keeps the existing progress banner when an incomplete guide is manually collapsed', async () => {
    const user = userEvent.setup()
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'new-user', role: 1 })
    await renderOverview()

    await user.click(
      await screen.findByRole('button', { name: 'Hide setup guide' })
    )
    expect(screen.getByText('Setup progress: 1/3')).toBeVisible()
    expect(
      screen.getByText('Setup guide is collapsed. Expand it anytime.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'API Keys' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Setup guide' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show setup guide' }))
    expect(
      screen.getByRole('button', { name: 'Hide setup guide' })
    ).toBeVisible()
  })

  it('removes the collapsed progress banner when the remaining setup step completes', async () => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'dashboard-user',
      role: 1,
      quota: 1000000,
    })
    window.localStorage.setItem(storageKey, 'collapsed')
    await renderOverview()
    expect(await screen.findByText('Setup progress: 2/3')).toBeVisible()

    act(() => {
      useAuthStore.getState().auth.setUser({
        id: 1,
        username: 'dashboard-user',
        role: 1,
        quota: 1000000,
        request_count: 1,
      })
    })
    expect(
      await screen.findByRole('button', { name: 'Setup guide' })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Setup progress:/)).not.toBeInTheDocument()
  })

  it('does not show a completed setup entry when the key lookup fails', async () => {
    keyLookupError = new Error('Key lookup unavailable')
    await renderOverview()

    expect(
      await screen.findByRole('button', { name: 'Hide setup guide' })
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Setup guide' })
    ).not.toBeInTheDocument()
  })
})
