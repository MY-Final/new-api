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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ErrorRequests } from '..'

const entry = {
  id: 1,
  request_id: 'req-403',
  user_id: 213,
  username: 'scurvy',
  token_id: 834,
  token_name: 'cn',
  model_name: 'deepseek-v4.1-flash',
  channel_id: 196,
  group: '1024 Free Tier',
  ip: '182.255.89.27',
  status_code: 403,
  error_code: 'upstream_error',
  error_type: 'openai_error',
  error_message: '本次请求命中本地安全规则',
  request_path: '/v1/chat/completions',
  is_stream: true,
  use_time: 2,
  body_bytes: 42,
  body_truncated: false,
  created_at: 1792832546,
}

function renderPage() {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/log/error') {
      return { data: { success: true, data: { items: [entry], total: 1 } } }
    }
    if (url === '/api/log/error/1') {
      return {
        data: {
          success: true,
          data: {
            ...entry,
            body: '{"messages":[{"role":"user","content":"hi"}]}',
          },
        },
      }
    }
    return { data: { success: true, data: null } }
  })
  vi.spyOn(api, 'delete').mockResolvedValue({ data: { success: true } })

  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const page = createRoute({
    getParentRoute: () => auth,
    path: '/error-requests',
    component: ErrorRequests,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([page])]),
    history: createMemoryHistory({ initialEntries: ['/error-requests'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('shows a captured request with its status and error message', async () => {
  renderPage()

  expect(await screen.findByText('403')).toBeVisible()
  expect(screen.getByText('scurvy (#213)')).toBeVisible()
  expect(screen.getByText('本次请求命中本地安全规则')).toBeVisible()
})

it('opens the captured body from the detail action', async () => {
  renderPage()
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: 'View details' }))

  expect(await screen.findByText('Error request details')).toBeVisible()
  expect(
    await screen.findByText((content) => content.includes('"content": "hi"'))
  ).toBeVisible()
})

it('deletes a captured request after confirmation', async () => {
  renderPage()
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

  await waitFor(() =>
    expect(api.delete).toHaveBeenCalledWith('/api/log/error/1')
  )
})
