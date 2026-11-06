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
  client_id: 'kuncode-setup',
  request_id: 42,
  device_name: 'Windows 桌面',
  scopes: [
    'profile:read',
    'coding_tools:configure',
    'desktop_keys:read',
    'desktop_keys:write',
    'desktop_keys:reveal',
  ],
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
function requests(requestData = request) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown
    if (url === '/api/desktop/auth/request') {
      data = requestData
    } else if (url === '/api/user/self/groups') {
      data = {
        default: { ratio: 1, desc: 'Default group' },
        vip: { ratio: 2, desc: 'VIP group' },
        auto: { ratio: 'auto', desc: 'Automatic routing' },
      }
    } else {
      data = {
        scope: 'desktop.authorize',
        methods: [{ method: 'password', available: true }],
        oauth_providers: [],
        password_encryption_enabled: false,
      }
    }
    return { data: { success: true, data } }
  })
  return get
}

it('shows Magpie-specific browser authorization details', async () => {
  const get = requests({
    ...request,
    client_id: 'magpie',
    scopes: ['profile:read', 'wallet:read', 'wallet:write'],
  })
  show()
  expect(
    await screen.findByRole('heading', { name: 'Authorize Magpie' })
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      'Magpie can read your profile and wallet balance, and perform your daily check-in. It cannot change your account or model keys.'
    )
  ).toBeInTheDocument()
  expect(
    await screen.findByRole('combobox', { name: 'Group' })
  ).toHaveTextContent('default')
  expect(get).toHaveBeenCalledWith(
    '/api/desktop/auth/request',
    expect.objectContaining({ disableDuplicate: true })
  )
  expect(get).toHaveBeenCalledWith('/api/user/self/groups', {
    disableDuplicate: true,
  })
  expect(screen.queryByText('Authorize KunCode Setup')).not.toBeInTheDocument()
})

it('authorizes Magpie with the selected model group', async () => {
  requests({
    ...request,
    client_id: 'magpie',
    scopes: ['profile:read', 'wallet:read', 'wallet:write'],
  })
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
  show()
  const user = userEvent.setup()
  const group = await screen.findByRole('combobox', { name: 'Group' })
  await user.click(group)
  await user.click(await screen.findByText('VIP group'))
  await user.click(screen.getByRole('button', { name: 'Authorize' }))
  await user.type(
    await screen.findByLabelText('Password', { selector: 'input' }),
    'test-password'
  )
  await user.click(screen.getByRole('button', { name: 'Verify' }))

  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith(
      '/api/desktop/auth/authorize',
      { flow: 'f'.repeat(43), approve: true, group: 'vip' },
      {
        singleUseAuthorization: true,
        headers: { 'X-Security-Proof': 'bound-test-proof' },
      }
    )
  )
  expect(post).toHaveBeenCalledWith(
    '/api/verify',
    expect.objectContaining({
      scope: 'desktop.authorize',
      context: { request_id: 42, group: 'vip' },
      method: 'password',
    }),
    expect.any(Object)
  )
})

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

it('shows the selected group on the success page before returning', async () => {
  requests({
    ...request,
    client_id: 'magpie',
    scopes: ['profile:read', 'wallet:read', 'wallet:write'],
  })
  vi.spyOn(api, 'post').mockImplementation(async (url) => ({
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
  const group = await screen.findByRole('combobox', { name: 'Group' })
  await user.click(group)
  await user.click(await screen.findByText('VIP group'))
  await user.click(screen.getByRole('button', { name: 'Authorize' }))
  await user.type(
    await screen.findByLabelText('Password', { selector: 'input' }),
    'test-password'
  )
  await user.click(screen.getByRole('button', { name: 'Verify' }))

  const success = await screen.findByRole('status')
  expect(within(success).getByText('Authorization complete')).toBeVisible()
  expect(within(success).getByText('vip')).toBeVisible()
  expect(
    within(success).getByRole('button', { name: 'Return now' })
  ).toBeVisible()
  await waitFor(() => expect(returned).toHaveBeenCalledOnce(), {
    timeout: 3000,
  })
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
  expect(
    await screen.findByRole('heading', { name: 'Authorization cancelled' })
  ).toBeInTheDocument()
  await waitFor(() => expect(returned).toHaveBeenCalledOnce(), {
    timeout: 3000,
  })
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
  expect(
    await screen.findByRole('heading', { name: 'Authorization complete' })
  ).toBeInTheDocument()
  await waitFor(() => expect(returned).toHaveBeenCalledOnce(), {
    timeout: 3000,
  })
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
