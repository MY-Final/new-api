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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { DesktopAuthorization } from '../authorization'

const request = {
  request_id: 42,
  device_name: 'Windows 桌面',
  scopes: ['profile:read', 'coding_tools:configure', 'desktop_keys:read', 'desktop_keys:write', 'desktop_keys:reveal'],
  expires_at: 2000000000,
}
const proof = {
  proof_token: 'bound-test-proof',
  scope: 'desktop.authorize',
  method: 'password',
  expires_at: 2000000000,
}

beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'owner', role: 1 })
})
afterEach(() => {
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})
function show(onReturn = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  render(
    <QueryClientProvider client={client}>
      <DesktopAuthorization flow={'f'.repeat(43)} onReturn={onReturn} />
    </QueryClientProvider>
  )
  return onReturn
}
function requests() {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/desktop/auth/request'
          ? request
          : {
              scope: 'desktop.authorize',
              methods: [{ method: 'password', available: true }],
              oauth_providers: [],
              password_encryption_enabled: false,
            },
    },
  }))
}

it('shows an expired request and offers no authorization actions', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new Error('expired'))
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'invalid or expired'
  )
  expect(
    screen.queryByRole('button', { name: 'Authorize' })
  ).not.toBeInTheDocument()
})

it('denies authorization without asking for security verification', async () => {
  requests()
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        callback_url:
          'http://127.0.0.1:31415/callback?state=state&error=access_denied',
      },
    },
  })
  const returned = show()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(returned).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledExactlyOnceWith(
    '/api/desktop/auth/authorize',
    { flow: 'f'.repeat(43), approve: false },
    { singleUseAuthorization: true }
  )
})

it('binds password verification to the request and submits approval once', async () => {
  requests()
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/verify'
          ? proof
          : {
              callback_url:
                'http://127.0.0.1:31415/callback?state=state&code=code',
            },
    },
  }))
  const returned = show()
  const user = userEvent.setup()
  const approve = await screen.findByRole('button', {
    name: 'Authorize',
  })
  await user.click(approve)
  expect(approve).toBeDisabled()
  await user.type(
    await screen.findByLabelText('Password', { selector: 'input' }),
    'test-password'
  )
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  await waitFor(() => expect(returned).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledWith(
    '/api/verify',
    expect.objectContaining({
      scope: 'desktop.authorize',
      context: { request_id: 42 },
      method: 'password',
    }),
    expect.any(Object)
  )
  expect(post).toHaveBeenLastCalledWith(
    '/api/desktop/auth/authorize',
    { flow: 'f'.repeat(43), approve: true },
    {
      singleUseAuthorization: true,
      headers: { 'X-Security-Proof': 'bound-test-proof' },
    }
  )
})

it('cancelling security verification leaves the request unapproved', async () => {
  requests()
  const post = vi.spyOn(api, 'post')
  show()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Authorize' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Authorize' })).toBeEnabled()
  )
  expect(post).not.toHaveBeenCalled()
})

it('rejects an external callback instead of forwarding authorization to it', async () => {
  requests()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: { callback_url: 'https://untrusted.example/callback?code=code' },
    },
  })
  const error = vi.spyOn(toast, 'error')
  const returned = show()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(error).toHaveBeenCalled())
  expect(returned).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Authorize' })).toBeEnabled()
})

