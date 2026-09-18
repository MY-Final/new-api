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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { UsageLogsProvider } from '../usage-logs-provider'
import { UsageLogsTable } from '../usage-logs-table'

const pointerCaptureDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'setPointerCapture'
)

interface ApiCallCounts {
  logs: number
  stats: number
}

function Fixture() {
  return (
    <UsageLogsProvider>
      <UsageLogsTable logCategory='common' />
    </UsageLogsProvider>
  )
}

async function renderLogs() {
  const counts: ApiCallCounts = { logs: 0, stats: 0 }
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url.startsWith('/api/log/self/stat')) {
      counts.stats++
    } else if (url.startsWith('/api/log/self')) {
      counts.logs++
    }
    return {
      data: {
        success: true,
        data: { items: [], total: 0, quota: 0, rpm: 0, tpm: 0 },
      },
    }
  })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: Fixture,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({ initialEntries: ['/usage-logs/common'] }),
  })
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByText('Usage')
  return counts
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (pointerCaptureDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'setPointerCapture',
      pointerCaptureDescriptor
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  }
})

it('defaults to off and lists every refresh cadence', async () => {
  await renderLogs()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Auto refresh' }))
  expect(screen.getByRole('menuitemradio', { name: 'Off' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  for (const label of ['5 seconds', '10 seconds', '1 minute', '5 minutes']) {
    expect(screen.getByRole('menuitemradio', { name: label })).toBeVisible()
  }
})

it('refreshes logs and stats on the selected interval and stops when disabled', async () => {
  const counts = await renderLogs()
  const initial = { ...counts }
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({
    advanceTimers: (ms) => vi.advanceTimersByTime(ms),
  })

  await vi.advanceTimersByTimeAsync(60_000)
  expect(counts).toEqual(initial)

  await user.click(screen.getByRole('button', { name: 'Auto refresh' }))
  await user.click(screen.getByRole('menuitemradio', { name: '5 seconds' }))
  expect(
    screen.getByRole('button', { name: 'Auto refresh · 5 seconds' })
  ).toBeVisible()

  await vi.advanceTimersByTimeAsync(5_000)
  await vi.waitFor(() => {
    expect(counts.logs).toBeGreaterThan(initial.logs)
    expect(counts.stats).toBeGreaterThan(initial.stats)
  })

  const whileActive = { ...counts }
  await user.click(screen.getByRole('menuitemradio', { name: 'Off' }))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(counts).toEqual(whileActive)
})
