import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { Dialog } from '@/components/dialog'
import { api, getFreshAuthHeaders } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { usageLogSchema } from '../../data/schema'
import {
  LIVE_REFRESH_STORAGE_KEY,
  LogsRefreshControl,
} from '../logs-refresh-control'
import { UsageLogsProvider } from '../usage-logs-provider'
import { UsageLogsTable } from '../usage-logs-table'

const streams = vi.hoisted(
  () =>
    [] as {
      url: string
      headers: Record<string, string>
      close: ReturnType<typeof vi.fn>
      emit: (type: string, data?: string) => void
    }[]
)

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getFreshAuthHeaders: vi.fn(),
}))
vi.mock('sse.js', () => ({
  SSE: class {
    listeners = new Map<string, (event: Event) => void>()
    close = vi.fn()
    constructor(
      public url: string,
      options: { headers: Record<string, string> }
    ) {
      streams.push({
        url,
        headers: options.headers,
        close: this.close,
        emit: (type, data) => {
          const event = Object.assign(new Event(type), { data })
          this.listeners.get(type)?.(event)
        },
      })
    }
    addEventListener(type: string, listener: (event: Event) => void) {
      this.listeners.set(type, listener)
    }
    stream() {}
  },
}))

const originalAuth = useAuthStore.getState().auth
const now = new Date('2026-11-15T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  localStorage.clear()
  localStorage.setItem(LIVE_REFRESH_STORAGE_KEY, 'true')
  streams.length = 0
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.mocked(getFreshAuthHeaders).mockResolvedValue({
    Authorization: 'Bearer first-credential',
  })
  useAuthStore.setState({
    auth: {
      ...originalAuth,
      user: { id: 12, username: 'alice', role: 1 },
      session: {
        sid: 'log-viewer-session',
        current: true,
        login_method: 'password',
        ip: '',
        user_agent: '',
        created_at: 0,
        last_active_at: 0,
        expires_at: Math.floor(now.getTime() / 1000) + 3600,
      },
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  useAuthStore.setState({ auth: originalAuth })
})

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}

function fixture(
  overrides: Partial<
    Omit<
      ComponentProps<typeof LogsRefreshControl>,
      'onRefresh' | 'onShowLatest'
    >
  > = {}
) {
  return {
    isAdmin: false,
    pageIndex: 0,
    endTime: undefined,
    onRefresh: vi.fn<() => Promise<void>>().mockResolvedValue(),
    onShowLatest: vi.fn(),
    ...overrides,
  }
}

function renderControl(
  props: ReturnType<typeof fixture>,
  children?: ReactNode
) {
  return render(
    <UsageLogsProvider>
      <LogsRefreshControl {...props} />
      {children}
    </UsageLogsProvider>
  )
}

async function ready(interval = 3000) {
  await act(async () => {
    streams
      .at(-1)
      ?.emit('ready', JSON.stringify({ refresh_interval_ms: interval }))
  })
}

it.each([
  { isAdmin: false, url: '/api/log/self/stream', interval: 3000 },
  { isAdmin: true, url: '/api/log/stream', interval: 5000 },
])(
  'subscribes with fresh authorization to $url and coalesces changes at $interval ms',
  async ({ isAdmin, url, interval }) => {
    const props = fixture({ isAdmin })
    renderControl(props)
    await advance(0)
    expect(streams[0].url).toBe(url)
    expect(streams[0].headers.Authorization).toBe('Bearer first-credential')
    await ready(interval)
    expect(
      screen.queryByRole('button', { name: 'New logs available' })
    ).not.toBeInTheDocument()
    await advance(interval)
    props.onRefresh.mockClear()

    act(() => {
      streams[0].emit('changed')
      streams[0].emit('changed')
      streams[0].emit('changed')
    })
    await advance(interval - 1000)
    expect(props.onRefresh).not.toHaveBeenCalled()
    await advance(1000)
    expect(props.onRefresh).toHaveBeenCalledOnce()
    await advance(15000)
    expect(props.onRefresh).toHaveBeenCalledOnce()
  }
)

it('applies settings changes to an open stream without reconnecting or triggering an extra refresh', async () => {
  const props = fixture()
  renderControl(props)
  await advance(0)
  await ready(1000)
  await advance(1000)
  props.onRefresh.mockClear()

  act(() =>
    streams[0].emit('settings', JSON.stringify({ refresh_interval_ms: 8000 }))
  )
  await advance(1000)
  expect(props.onRefresh).not.toHaveBeenCalled()
  act(() => streams[0].emit('changed'))
  await advance(6000)
  expect(props.onRefresh).not.toHaveBeenCalled()
  await advance(1000)
  expect(props.onRefresh).toHaveBeenCalledOnce()

  act(() => {
    streams[0].emit('settings', JSON.stringify({ refresh_interval_ms: 1000 }))
    streams[0].emit('changed')
  })
  await advance(1000)
  expect(props.onRefresh).toHaveBeenCalledTimes(2)
  expect(streams).toHaveLength(1)
  expect(streams[0].close).not.toHaveBeenCalled()
})

it.each([
  { pageIndex: 1, endTime: undefined },
  { pageIndex: 0, endTime: now.getTime() - 1000 },
])('keeps historical rows stable with $pageIndex / $endTime', async (scope) => {
  const props = fixture(scope)
  const view = renderControl(props)
  await advance(0)
  await ready()
  act(() => streams[0].emit('changed'))
  await advance(5000)
  expect(props.onRefresh).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('Live refresh paused')
  fireEvent.click(screen.getByRole('button', { name: 'New logs available' }))
  expect(props.onShowLatest).toHaveBeenCalledOnce()
  view.rerender(
    <UsageLogsProvider>
      <LogsRefreshControl {...props} pageIndex={0} endTime={undefined} />
    </UsageLogsProvider>
  )
  await advance(1000)
  expect(props.onRefresh).toHaveBeenCalledOnce()
})

it('defers changes while a log dialog is open and refreshes after it closes', async () => {
  const props = fixture()
  const view = renderControl(
    props,
    <Dialog open title='Log details'>
      Stable log details
    </Dialog>
  )
  await advance(0)
  await ready()
  act(() => streams[0].emit('changed'))
  await advance(5000)
  expect(props.onRefresh).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toHaveTextContent('Stable log details')
  view.rerender(
    <UsageLogsProvider>
      <LogsRefreshControl {...props} />
    </UsageLogsProvider>
  )
  await advance(1000)
  expect(props.onRefresh).toHaveBeenCalledOnce()
})

it('pauses when the selected end time passes instead of repeatedly querying a fixed range', async () => {
  const props = fixture({ endTime: now.getTime() + 2000 })
  renderControl(props)
  await advance(0)
  await ready()
  await advance(3000)
  expect(props.onRefresh).not.toHaveBeenCalled()
})

it('closes the stream in the background and reconciles after becoming visible', async () => {
  const props = fixture()
  renderControl(props)
  await advance(0)
  await ready()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  fireEvent(document, new Event('visibilitychange'))
  expect(streams[0].close).toHaveBeenCalledOnce()
  await advance(60000)
  expect(props.onRefresh).not.toHaveBeenCalled()
  expect(streams).toHaveLength(1)
  vi.mocked(getFreshAuthHeaders).mockResolvedValue({
    Authorization: 'Bearer replacement-credential',
  })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  await advance(0)
  expect(streams[1].headers.Authorization).toBe('Bearer replacement-credential')
  await ready()
  await advance(1000)
  expect(props.onRefresh).toHaveBeenCalledOnce()
})

it('reconnects with fresh headers and uses low frequency reconciliation when streaming fails', async () => {
  const props = fixture()
  renderControl(props)
  await advance(0)
  await ready()
  await advance(3000)
  props.onRefresh.mockClear()
  act(() => streams[0].emit('error'))
  vi.mocked(getFreshAuthHeaders).mockResolvedValue({
    Authorization: 'Bearer replacement-credential',
  })
  await advance(2000)
  expect(streams[1].headers.Authorization).toBe('Bearer replacement-credential')
  act(() => streams[0].emit('changed'))
  await advance(20000)
  expect(props.onRefresh).not.toHaveBeenCalled()
  await advance(5000)
  expect(props.onRefresh).toHaveBeenCalledOnce()
  await ready()
  await advance(3000)
  expect(props.onRefresh).toHaveBeenCalledTimes(2)
})

it('keeps a failed refresh pending and backs off before retrying', async () => {
  const props = fixture()
  props.onRefresh.mockRejectedValueOnce(new Error('temporary failure'))
  renderControl(props)
  await advance(0)
  await ready()
  act(() => streams[0].emit('changed'))
  await advance(3000)
  expect(props.onRefresh).toHaveBeenCalledOnce()
  expect(
    screen.getByRole('button', { name: 'New logs available' })
  ).toBeInTheDocument()
  await advance(29000)
  expect(props.onRefresh).toHaveBeenCalledOnce()
  await advance(1000)
  expect(props.onRefresh).toHaveBeenCalledTimes(2)
})

it('retains changes arriving during a refresh and prevents overlapping requests', async () => {
  let finish: (() => void) | undefined
  const props = fixture()
  props.onRefresh.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve))
  )
  renderControl(props)
  await advance(0)
  await ready()
  await advance(3000)
  act(() => streams[0].emit('changed'))
  await advance(5000)
  expect(props.onRefresh).toHaveBeenCalledOnce()
  await act(async () => finish?.())
  await advance(1000)
  expect(props.onRefresh).toHaveBeenCalledTimes(2)
})

it('keeps live and polling modes exclusive and closes subscriptions on logout', async () => {
  vi.useRealTimers()
  const user = userEvent.setup()
  const props = fixture()
  renderControl(props)
  await act(async () => {})
  const trigger = screen.getByRole('button', { name: 'Live refresh' })
  await user.click(trigger)
  await user.click(
    screen.getByRole('menuitemradio', {
      name: 'Auto refresh · 5 seconds',
    })
  )
  expect(streams[0].close).toHaveBeenCalledOnce()
  expect(props.onRefresh).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  )
  await user.click(
    screen.getByRole('button', { name: 'Auto refresh · 5 seconds' })
  )
  await user.click(await screen.findByRole('menuitemradio', { name: 'Off' }))
  await waitFor(() =>
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  )
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  await user.click(
    await screen.findByRole('menuitemradio', { name: 'Live refresh' })
  )
  await act(async () => {})
  expect(streams).toHaveLength(2)
  act(() => useAuthStore.getState().auth.reset())
  expect(streams[1].close).toHaveBeenCalledOnce()
})

it('opens and closes the refresh menu from the keyboard', async () => {
  vi.useRealTimers()
  const user = userEvent.setup()
  renderControl(fixture())
  const trigger = screen.getByRole('button', { name: 'Live refresh' })
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('menu')).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
})

it('does not open a stream when credentials resolve after unmount', async () => {
  let resolveHeaders: ((headers: Record<string, string>) => void) | undefined
  vi.mocked(getFreshAuthHeaders).mockImplementationOnce(
    () => new Promise((resolve) => (resolveHeaders = resolve))
  )
  const view = renderControl(fixture())
  view.unmount()
  await act(async () =>
    resolveHeaders?.({ Authorization: 'Bearer late-credential' })
  )
  expect(streams).toHaveLength(0)
})

it('waits for a browser session before requesting stream credentials', async () => {
  useAuthStore.setState({
    auth: { ...useAuthStore.getState().auth, session: null },
  })
  renderControl(fixture())
  await advance(30000)
  expect(getFreshAuthHeaders).not.toHaveBeenCalled()
  expect(streams).toHaveLength(0)
})
it('updates the actual log table through the existing personal log API after a notification', async () => {
  vi.useRealTimers()
  let records = [
    usageLogSchema.parse({
      id: 1,
      user_id: 12,
      type: 2,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      model_name: 'before-model',
    }),
  ]
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url.startsWith('/api/log/self?')) {
      return { data: { success: true, data: { items: records, total: 1 } } }
    }
    const data = url === '/api/user/models' ? [] : {}
    return { data: { success: true, data } }
  })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => (
      <UsageLogsProvider>
        <UsageLogsTable logCategory='common' />
      </UsageLogsProvider>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({ initialEntries: ['/usage-logs/common'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByText('before-model')
  await ready(1000)
  records = [usageLogSchema.parse({ ...records[0], model_name: 'after-model' })]
  act(() => streams[0].emit('changed'))
  expect(await screen.findByText('after-model')).toBeVisible()
  expect(screen.queryByText('before-model')).not.toBeInTheDocument()
  view.unmount()
  client.clear()
})
