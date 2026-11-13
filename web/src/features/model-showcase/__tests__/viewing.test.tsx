import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { DirectionProvider } from '@/context/direction-provider'
import { FontProvider } from '@/context/font-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { ModelShowcase } from '..'
import { ShowcaseRunCard } from '../components/showcase-run-card'
import type { ShowcaseEntry, ShowcaseRun } from '../types'

const html =
  '<!doctype html><html><head><style>@keyframes spin {to {opacity:0.5}} svg {animation: spin 1s infinite}</style></head><body><svg width="1200" height="800"></svg></body></html>'
const run: ShowcaseRun = {
  id: 7,
  plan_id: 1,
  name: 'Pelican test',
  group: 'public',
  model: 'model-a',
  status: 'succeeded',
  started_at: 1794550000,
  completed_at: 1794550010,
  duration_ms: 10000,
  prompt_tokens: 100,
  completion_tokens: 200,
}
const entry: ShowcaseEntry = {
  id: 1,
  name: 'Pelican test',
  group: 'public',
  model: 'model-a',
  prompt: 'Draw a pelican',
  interval_minutes: 60,
  keep_count: 24,
  max_output_tokens: 9216,
  timeout_seconds: 1800,
  enabled: true,
  public: true,
  sort_order: 0,
  next_run_at: 1794553600,
  run_requested: false,
  runs: [run],
}
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useAuthStore.getState().auth.reset()
  localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      close() {}
    }
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      callback: IntersectionObserverCallback
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
      }
      observe(target: Element) {
        queueMicrotask(() =>
          this.callback(
            [
              { target, isIntersecting: true, intersectionRatio: 1 },
            ] as IntersectionObserverEntry[],
            this as unknown as IntersectionObserver
          )
        )
      }
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  client.clear()
  useAuthStore.getState().auth.reset()
  localStorage.clear()
  vi.unstubAllGlobals()
})

test.each([false, true])(
  'shared results remain read-only with signed-in=%s and keep the appropriate layout',
  async (signedIn) => {
    const user = { id: 1, username: 'alice', role: 1 }
    client.setQueryData(['status'], { SidebarModulesAdmin: '' })
    client.setQueryData(['custom-pages'], [])
    if (signedIn) {
      useAuthStore.getState().auth.setUser(user)
      client.setQueryData(['user', 'self', user.id], user)
    }
    const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/showcase') {
        return { data: { success: true, data: [entry] } }
      }
      if (url === '/api/showcase/runs/7') {
        return {
          data: {
            success: true,
            data: { ...run, output: html, prompt: 'Original prompt' },
          },
        }
      }
      if (url === '/api/notice') {
        return { data: { success: true, data: '' } }
      }
      if (url === '/api/user/self') {
        return { data: { success: true, data: user } }
      }
      return { data: { success: true, data: [] } }
    })
    const post = vi.spyOn(api, 'post')
    const root = createRootRoute()
    const route = createRoute({
      getParentRoute: () => root,
      path: '/showcase',
      component: ModelShowcase,
    })
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/showcase'] }),
    })
    await router.load()
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <FontProvider>
            <DirectionProvider>
              <RouterProvider router={router} />
            </DirectionProvider>
          </FontProvider>
        </ThemeProvider>
      </QueryClientProvider>
    )
    expect(
      await screen.findByRole('heading', { name: 'Pelican test' })
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Run now' })
    ).not.toBeInTheDocument()
    if (signedIn) {
      expect(
        screen.getByRole('link', { name: 'Model showcase' })
      ).toHaveAttribute('href', '/showcase')
      expect(
        screen.getByRole('link', { name: 'Model showcase' })
      ).toHaveAttribute('data-active')
      expect(
        screen.getByRole('heading', { name: 'Model showcase' }).closest('main')
      ).toHaveClass('overflow-y-auto')
    } else {
      expect(
        screen.queryByRole('link', { name: 'Model showcase' })
      ).not.toBeInTheDocument()
    }
    expect(
      screen.queryByRole('link', { name: 'Manage test plans' })
    ).not.toBeInTheDocument()
    const region = screen.getByRole('region', { name: 'Pelican test' })
    expect(region.querySelector('[data-slot="carousel-item"]')).toHaveClass(
      'basis-[282px]'
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    )
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(
        get.mock.calls.filter(([url]) => url === '/api/showcase')
      ).toHaveLength(2)
    )
    expect(post).not.toHaveBeenCalled()
  }
)

test('animation previews stay sandboxed and pause when the card leaves the viewport', async () => {
  let intersection: IntersectionObserverCallback | undefined
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { ...run, output: html, prompt: 'Original prompt' },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <ShowcaseRunCard run={run} />
    </QueryClientProvider>
  )
  expect(get).not.toHaveBeenCalled()
  await act(async () =>
    intersection?.(
      [{ isIntersecting: true }] as IntersectionObserverEntry[],
      {} as IntersectionObserver
    )
  )
  const frame = await screen.findByTitle('Drawing animation preview')
  expect(frame).toHaveAttribute('sandbox', '')
  expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'")
  expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
  await act(async () =>
    intersection?.(
      [{ isIntersecting: false }] as IntersectionObserverEntry[],
      {} as IntersectionObserver
    )
  )
  expect(
    screen.queryByTitle('Drawing animation preview')
  ).not.toBeInTheDocument()
})

test('unsafe model output remains readable as text and is never embedded', async () => {
  const output = html.replace(
    '</head>',
    '<script>window.showcaseUnsafe = true</script></head>'
  )
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { ...run, output, prompt: 'Original historical prompt' },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <ShowcaseRunCard run={run} />
    </QueryClientProvider>
  )
  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(
    screen.queryByTitle('Drawing animation preview')
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'View details' }))
  expect(await screen.findByText('Original historical prompt')).toBeVisible()
  expect(screen.getByText(output)).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
})

test('failed runs retain their error and raw output details', async () => {
  const failed: ShowcaseRun = {
    ...run,
    status: 'failed',
    error: 'The model did not return a complete HTML and SVG document.',
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...failed,
        output: 'Incomplete result',
        prompt: 'Original prompt',
      },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <ShowcaseRunCard run={failed} />
    </QueryClientProvider>
  )
  expect(screen.getByText('Failed')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'View details' }))
  expect(await screen.findByText('Incomplete result')).toBeVisible()
  expect(
    screen.queryByTitle('Drawing animation preview')
  ).not.toBeInTheDocument()
})
