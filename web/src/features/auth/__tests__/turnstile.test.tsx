import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FunctionComponent } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { Turnstile } from '@/components/turnstile'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { ForgotPasswordForm } from '../forgot-password/components/forgot-password-form'
import { UserAuthForm } from '../sign-in/components/user-auth-form'
import { SignUpForm } from '../sign-up/components/sign-up-form'
import type { SystemStatus } from '../types'

let client: QueryClient
let turnstileApi: NonNullable<Window['turnstile']>
let widget: {
  callback: (token: string) => void
  'expired-callback': () => void
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  localStorage.clear()
  useAuthStore.getState().auth.reset()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'Request rejected' },
  })
  turnstileApi = {
    render: vi.fn((_element, options) => {
      widget = options as typeof widget
      return 'test-widget'
    }),
    remove: vi.fn(),
  }
  window.turnstile = turnstileApi
})

afterEach(() => {
  client.clear()
  useAuthStore.getState().auth.reset()
  localStorage.clear()
  delete window.turnstile
  document.querySelector('#cf-turnstile')?.remove()
})

async function renderForm(
  component: FunctionComponent,
  status: Partial<SystemStatus>
) {
  client.setQueryData(['status'], {
    turnstile_check: true,
    turnstile_site_key: 'site-key',
    ...status,
  })
  const router = createRouter({
    routeTree: createRootRoute({ component }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

test.each([
  { register: false, email: false },
  { register: true, email: false },
  { register: false, email: true },
  { register: true, email: true },
])(
  'registration and email verification gate their own actions: %j',
  async ({ register, email }) => {
    await renderForm(SignUpForm, {
      email_verification: true,
      turnstile_scenes: { register, email_verification: email },
    })
    const user = userEvent.setup()
    await user.type(
      screen.getByRole('textbox', {
        name: 'Email (required for verification)',
      }),
      'alice@example.com'
    )
    expect(
      screen.getByRole('button', { name: 'Create account' })
    ).toHaveProperty('disabled', register)
    expect(screen.getByRole('button', { name: 'Send code' })).toHaveProperty(
      'disabled',
      email
    )
    expect(vi.mocked(turnstileApi.render).mock.calls.length > 0).toBe(
      register || email
    )
    if (register || email) {
      act(() => widget.callback('one-time-token'))
      expect(
        screen.getByRole('button', { name: 'Create account' })
      ).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Send code' })).toBeEnabled()
      act(() => widget['expired-callback']())
      expect(
        screen.getByRole('button', { name: 'Create account' })
      ).toHaveProperty('disabled', register)
      expect(screen.getByRole('button', { name: 'Send code' })).toHaveProperty(
        'disabled',
        email
      )
    }
  }
)

test.each([
  { register: false, email: true },
  { register: true, email: false },
])(
  'sending registration email consumes CAPTCHA only for its own enabled scene: %j',
  async ({ register, email }) => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: false, message: 'Email rejected' },
    })
    await renderForm(SignUpForm, {
      email_verification: true,
      turnstile_scenes: { register, email_verification: email },
    })
    await userEvent.type(
      screen.getByRole('textbox', {
        name: 'Email (required for verification)',
      }),
      'alice@example.com'
    )
    act(() => widget.callback('one-time-token'))
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/api/verification', {
        params: { email: 'alice@example.com', turnstile: 'one-time-token' },
      })
    )
    expect(screen.getByRole('button', { name: 'Send code' })).toHaveProperty(
      'disabled',
      email
    )
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
  }
)

test('password reset honors its scene switch and clears a rejected token before retrying', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: false, message: 'Reset request rejected' },
  })
  await renderForm(ForgotPasswordForm, {})
  const submit = screen.getByRole('button', { name: 'Send reset email' })
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Email' }),
    'alice@example.com'
  )
  expect(submit).toBeDisabled()
  act(() => widget.callback('reset-token'))
  await waitFor(() => expect(submit).toBeEnabled())
  await userEvent.click(submit)
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/api/reset_password', {
      params: { email: 'alice@example.com', turnstile: 'reset-token' },
    })
  )
  expect(submit).toBeDisabled()
  act(() =>
    client.setQueryData(['status'], {
      turnstile_check: true,
      turnstile_site_key: 'site-key',
      turnstile_scenes: { password_reset: false },
    })
  )
  await waitFor(() => expect(submit).toBeEnabled())
})

test('password login can proceed without CAPTCHA while registration remains protected', async () => {
  await renderForm(UserAuthForm, {
    turnstile_scenes: { login: false, register: true },
  })
  const user = userEvent.setup()
  await user.type(
    screen.getByRole('textbox', { name: 'Username or Email' }),
    'alice'
  )
  await user.type(screen.getByLabelText('Password'), 'correct-password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/user/login?turnstile=',
      { username: 'alice', password: 'correct-password' },
      { skipAuthRefresh: true }
    )
  )
  expect(turnstileApi.render).not.toHaveBeenCalled()
})

test('password login rejects missing or expired CAPTCHA and consumes a rejected submission token before retry', async () => {
  await renderForm(UserAuthForm, { turnstile_scenes: { login: true } })
  const user = userEvent.setup()
  await user.type(
    screen.getByRole('textbox', { name: 'Username or Email' }),
    'alice'
  )
  await user.type(screen.getByLabelText('Password'), 'correct-password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(api.post).not.toHaveBeenCalled()

  act(() => widget.callback('expired-token'))
  act(() => widget['expired-callback']())
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(api.post).not.toHaveBeenCalled()

  act(() => widget.callback('first-token'))
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/user/login?turnstile=first-token',
      { username: 'alice', password: 'correct-password' },
      { skipAuthRefresh: true }
    )
  )
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(api.post).toHaveBeenCalledTimes(1)

  act(() => widget.callback('retry-token'))
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() =>
    expect(api.post).toHaveBeenLastCalledWith(
      '/api/user/login?turnstile=retry-token',
      { username: 'alice', password: 'correct-password' },
      { skipAuthRefresh: true }
    )
  )
  expect(useAuthStore.getState().auth.user).toBeNull()
})

test('a widget remounted while the shared script loads initializes once and removes its instance on unmount', () => {
  const turnstile = turnstileApi
  delete window.turnstile
  const verify = vi.fn()
  const view = render(
    <Turnstile key='first' siteKey='site-key' onVerify={verify} />
  )
  view.rerender(
    <Turnstile key='replacement' siteKey='site-key' onVerify={verify} />
  )
  expect(document.querySelectorAll('#cf-turnstile')).toHaveLength(1)
  window.turnstile = turnstile
  act(() =>
    document.querySelector('#cf-turnstile')?.dispatchEvent(new Event('load'))
  )
  expect(turnstile.render).toHaveBeenCalledTimes(1)
  act(() => widget.callback('loaded-token'))
  expect(verify).toHaveBeenCalledWith('loaded-token')
  view.unmount()
  expect(turnstile.remove).toHaveBeenCalledWith('test-widget')
})
