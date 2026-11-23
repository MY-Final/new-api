import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createOAuthAuthorization } from '@/features/auth/api'
import {
  getAffiliateCode,
  getInviteCode,
  saveAffiliateCode,
  saveInviteCode,
} from '@/features/auth/lib/storage'
import { api } from '@/lib/api'

import { SignUpForm } from '../components/sign-up-form'

let client: QueryClient

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/sign-up')
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(['status'], { oauth_register_enabled: false })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'Registration rejected' },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        code: 'launch',
        name: 'Launch',
        available: true,
        bonus_quota: 0,
      },
    },
  })
})

afterEach(() => {
  client.clear()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

async function renderRegistration() {
  const router = createRouter({
    routeTree: createRootRoute({ component: SignUpForm }),
    history: createMemoryHistory({ initialEntries: ['/sign-up'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

async function submitRegistration() {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'Username' }), 'alice')
  await user.type(
    screen.getByLabelText('Password', { exact: true }),
    'correct-password'
  )
  await user.type(
    screen.getByLabelText('Confirm password', { exact: true }),
    'correct-password'
  )
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

test.each(['', 'Ab9Z'])(
  'registering with personal invitation code "%s" sends only the referral field',
  async (code) => {
    await renderRegistration()
    const referral = screen.getByRole('textbox', {
      name: 'Referral code (optional)',
    })
    if (code) await userEvent.type(referral, code)

    expect(
      screen.getByRole('textbox', {
        name: 'Campaign invitation code (optional)',
      })
    ).toHaveValue('')
    await submitRegistration()

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/api/user/register',
        expect.objectContaining({
          aff_code: code || undefined,
          invite_code: undefined,
        }),
        expect.anything()
      )
    )
    expect(api.get).not.toHaveBeenCalled()
  }
)

test('link parameters fill separate referral and campaign fields and override saved codes', async () => {
  saveAffiliateCode('OldReferral')
  saveInviteCode('old-campaign')
  window.history.replaceState(null, '', '/sign-up?aff=Ab9Z&invite_code=LAUNCH')
  await renderRegistration()

  expect(
    screen.getByRole('textbox', { name: 'Referral code (optional)' })
  ).toHaveValue('Ab9Z')
  expect(
    screen.getByRole('textbox', { name: 'Campaign invitation code (optional)' })
  ).toHaveValue('launch')
  expect(
    await screen.findByText('Invitation code available: Launch')
  ).toBeVisible()
  expect(api.get).toHaveBeenCalledWith(
    '/api/invite_codes/public/launch',
    expect.anything()
  )
  await submitRegistration()

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/user/register',
      expect.objectContaining({ aff_code: 'Ab9Z', invite_code: 'launch' }),
      expect.anything()
    )
  )
})

test('clearing a saved personal code removes it from registration and pending OAuth attribution', async () => {
  saveAffiliateCode('Ab9Z')
  await renderRegistration()
  const referral = screen.getByRole('textbox', {
    name: 'Referral code (optional)',
  })
  expect(referral).toHaveValue('Ab9Z')
  await userEvent.clear(referral)
  expect(getAffiliateCode()).toBe('')
  await submitRegistration()

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/user/register',
      expect.objectContaining({ aff_code: undefined, invite_code: undefined }),
      expect.anything()
    )
  )
})

test('an unavailable campaign can be cleared while retaining the personal referral', async () => {
  saveAffiliateCode('Ab9Z')
  saveInviteCode('missing-campaign')
  vi.mocked(api.get).mockRejectedValue({
    isAxiosError: true,
    response: { status: 404 },
  })
  await renderRegistration()
  expect(
    await screen.findByText('This invitation code is unavailable.')
  ).toBeVisible()
  await userEvent.clear(
    screen.getByRole('textbox', { name: 'Campaign invitation code (optional)' })
  )
  expect(getInviteCode()).toBe('')
  await submitRegistration()

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/user/register',
      expect.objectContaining({ aff_code: 'Ab9Z', invite_code: undefined }),
      expect.anything()
    )
  )
})

test('an overlong personal code shows a field error and prevents submission', async () => {
  await renderRegistration()
  const referral = screen.getByRole('textbox', {
    name: 'Referral code (optional)',
  })
  await userEvent.type(referral, 'a'.repeat(33))
  await submitRegistration()

  expect(
    await screen.findByText('Referral code must be at most 32 characters')
  ).toBeVisible()
  expect(referral).toHaveAttribute('aria-invalid', 'true')
  expect(api.post).not.toHaveBeenCalled()
})

test('editing both codes carries their separate values into OAuth registration', async () => {
  await renderRegistration()
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Referral code (optional)' }),
    'Ab9Z'
  )
  await userEvent.type(
    screen.getByRole('textbox', {
      name: 'Campaign invitation code (optional)',
    }),
    'LAUNCH'
  )
  vi.mocked(api.post).mockResolvedValue({
    data: { success: true, data: { flow_token: 'oauth-state' } },
  })
  await createOAuthAuthorization('github', 'login')

  expect(api.post).toHaveBeenCalledWith(
    '/api/oauth/state',
    expect.objectContaining({ aff: 'Ab9Z', invite_code: 'launch' }),
    expect.anything()
  )
})
