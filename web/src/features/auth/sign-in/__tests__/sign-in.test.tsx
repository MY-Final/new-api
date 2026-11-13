import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  ThemeCustomizationProvider,
  useThemeCustomization,
} from '@/context/theme-customization-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { SignIn } from '..'
import type { SystemStatus } from '../../types'

const clients: QueryClient[] = []
const initialSystemState = useSystemConfigStore.getState()

function PresetControl() {
  const { setPreset } = useThemeCustomization()
  return (
    <button type='button' onClick={() => setPreset('basketball')}>
      Basketball preset
    </button>
  )
}

async function renderSignIn(status: Partial<SystemStatus> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  clients.push(client)
  client.setQueryData(['status'], {
    register_enabled: true,
    password_login_enabled: true,
    ...status,
  })
  const root = createRootRoute({ component: Outlet })
  const auth = createRoute({ getParentRoute: () => root, id: '(auth)' })
  const signIn = createRoute({
    getParentRoute: () => auth,
    path: '/sign-in',
    validateSearch: (search) => ({
      redirect:
        typeof search.redirect === 'string' ? search.redirect : undefined,
    }),
    component: SignIn,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([signIn])]),
    history: createMemoryHistory({
      initialEntries: ['/sign-in?redirect=%2Fkeys'],
    }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ThemeCustomizationProvider>
          <PresetControl />
          <RouterProvider router={router} />
        </ThemeCustomizationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
  await screen.findByRole('heading', { name: 'Welcome back!' })
}

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.reset('idle')
  useSystemConfigStore.getState().setLoading(false)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'Login failed' },
  })
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  localStorage.clear()
  useAuthStore.getState().auth.reset('idle')
  useSystemConfigStore.setState(initialSystemState, true)
  document.documentElement.classList.remove('light', 'dark')
  for (const name of document.body.getAttributeNames()) {
    if (name.startsWith('data-theme-')) document.body.removeAttribute(name)
  }
})

it('keeps the form first on mobile and adapts the showcase artwork to the selected preset', async () => {
  await renderSignIn()
  const showcase = screen.getByRole('region', {
    name: 'Your creative backstage',
  })
  expect(showcase.closest('aside')).toHaveClass('hidden', 'lg:flex')
  expect(within(showcase).getByRole('img', { hidden: true })).toHaveAttribute(
    'aria-label',
    'Black and white suspenders'
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Basketball preset' })
  )

  expect(within(showcase).getByRole('img', { hidden: true })).toHaveAttribute(
    'aria-label',
    'Basketball'
  )
  expect(
    screen.getByRole('textbox', { name: 'Username or Email' })
  ).toBeVisible()
})

it('preserves the registration destination and contact links in the new layout', async () => {
  await renderSignIn({
    contact: {
      qq_group_number: '123456',
      qq_group_url: 'https://example.com/community',
    },
  })

  const registration = new URL(
    screen.getByRole('link', { name: 'Sign up' }).getAttribute('href') ?? '',
    location.origin
  )
  expect(registration.pathname).toBe('/sign-up')
  expect(registration.searchParams.get('redirect')).toBe('/keys')
  expect(screen.getByRole('link', { name: 'Contact Us' })).toHaveAttribute(
    'href',
    '/contact'
  )
  expect(screen.getByRole('link', { name: 'Join QQ Group' })).toHaveAttribute(
    'href',
    'https://example.com/community'
  )
})

it.each([{ register_enabled: false }, { self_use_mode_enabled: true }])(
  'hides registration when the server config is %j',
  async (status) => {
    await renderSignIn(status)
    expect(
      screen.queryByRole('link', { name: 'Sign up' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  }
)

it('keeps password-manager autofill and keyboard submission available, then allows retry after rejection', async () => {
  await renderSignIn()
  const user = userEvent.setup()
  const username = screen.getByRole('textbox', { name: 'Username or Email' })
  const password = screen.getByLabelText('Password')
  expect(username).toHaveAttribute('autocomplete', 'username')
  expect(password).toHaveAttribute('autocomplete', 'current-password')
  await user.click(username)
  await user.paste('alice')
  await user.tab()
  expect(password).toHaveFocus()
  await user.paste('correct-password')
  await user.keyboard('{Enter}')

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/user/login?turnstile=',
      { username: 'alice', password: 'correct-password' },
      { skipAuthRefresh: true }
    )
  )
  expect(useAuthStore.getState().auth.user).toBeNull()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
})

it('keeps alternative login methods available when password login is disabled', async () => {
  await renderSignIn({
    password_login_enabled: false,
    passkey_login: true,
    github_oauth: true,
  })

  expect(screen.queryByLabelText('Username or Email')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Sign in' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Sign in with Passkey' })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /GitHub/ })).toBeEnabled()
  expect(api.post).not.toHaveBeenCalled()
})

it('keeps password visibility keyboard accessible without submitting the form', async () => {
  await renderSignIn()
  const password = screen.getByLabelText('Password')
  const toggle = screen.getByRole('button', {
    name: 'Toggle password visibility',
  })
  expect(password).toHaveAttribute('type', 'password')
  toggle.focus()

  await userEvent.keyboard(' ')
  expect(password).toHaveAttribute('type', 'text')
  await userEvent.keyboard(' ')
  expect(password).toHaveAttribute('type', 'password')
  expect(api.post).not.toHaveBeenCalled()
})

it('reserves separate grid columns for the password label and reset link on narrow screens', async () => {
  await renderSignIn()
  const reset = screen.getByRole('link', { name: 'Forgot password?' })
  const passwordField = screen
    .getByLabelText('Password')
    .closest('[data-slot="form-item"]')

  expect(reset).not.toHaveClass('absolute')
  expect(reset).toHaveClass('col-start-2', 'row-start-1')
  expect(passwordField).toHaveClass('grid-cols-[minmax(0,1fr)_auto]')
})

it('requires legal consent before submitting from the new card', async () => {
  await renderSignIn({
    user_agreement_enabled: true,
    privacy_policy_enabled: true,
  })
  const user = userEvent.setup()
  await user.type(
    screen.getByRole('textbox', { name: 'Username or Email' }),
    'alice'
  )
  await user.type(screen.getByLabelText('Password'), 'correct-password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(api.post).not.toHaveBeenCalled()

  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  expect(useAuthStore.getState().auth.user).toBeNull()
})
