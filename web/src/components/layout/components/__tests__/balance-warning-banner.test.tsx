/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { DEFAULT_QUOTA_WARNING_THRESHOLD } from '@/features/profile/constants'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'

import { BalanceWarningBanner } from '../balance-warning-banner'

const getSelf = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({ getSelf }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

const baseUser: AuthUser = {
  id: 1,
  username: 'test-user',
  role: 1,
  quota: 1_000_000,
}

const queryClients: QueryClient[] = []

function renderBanner() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClients.push(queryClient)

  return render(
    <QueryClientProvider client={queryClient}>
      <BalanceWarningBanner />
    </QueryClientProvider>
  )
}

function setUser(overrides: Partial<AuthUser>): AuthUser {
  const user = { ...baseUser, ...overrides }
  useAuthStore.getState().auth.setUser(user)
  return user
}

function expectBannerVisible() {
  expect(screen.getByRole('alert')).toBeInTheDocument()
}

afterEach(() => {
  for (const queryClient of queryClients) queryClient.clear()
  queryClients.length = 0
  useAuthStore.getState().auth.setUser(null)
})

beforeEach(() => {
  getSelf.mockReset()
})

describe('BalanceWarningBanner', () => {
  test('stays hidden when the balance is above the default threshold', () => {
    const user = setUser({ quota: DEFAULT_QUOTA_WARNING_THRESHOLD + 1 })
    getSelf.mockResolvedValue({ success: true, data: user })

    renderBanner()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('shows when the balance equals the default threshold', () => {
    const user = setUser({ quota: DEFAULT_QUOTA_WARNING_THRESHOLD })
    getSelf.mockResolvedValue({ success: true, data: user })

    renderBanner()

    expectBannerVisible()
  })

  test('shows a negative balance and links to the wallet', () => {
    const user = setUser({ quota: -1 })
    getSelf.mockResolvedValue({ success: true, data: user })

    renderBanner()

    expectBannerVisible()
    expect(
      screen.getByRole('button', { name: /Go to Wallet/ })
    ).toHaveAttribute('href', '/wallet')
  })

  test('uses a valid custom warning threshold', () => {
    const user = setUser({
      quota: 100,
      setting: { quota_warning_threshold: 100 },
    })
    getSelf.mockResolvedValue({ success: true, data: user })

    renderBanner()

    expectBannerVisible()
  })

  test('falls back to the default threshold for an invalid custom value', () => {
    const user = setUser({
      quota: DEFAULT_QUOTA_WARNING_THRESHOLD,
      setting: { quota_warning_threshold: 'invalid' },
    })
    getSelf.mockResolvedValue({ success: true, data: user })

    renderBanner()

    expectBannerVisible()
  })

  test('keeps the existing balance when the refresh request fails', async () => {
    setUser({ quota: DEFAULT_QUOTA_WARNING_THRESHOLD + 1 })
    getSelf.mockRejectedValue(new Error('network error'))

    renderBanner()

    await waitFor(() => expect(getSelf).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('syncs a successful refresh into the auth store', async () => {
    const initialUser = setUser({ quota: 1_000_000 })
    const refreshedUser = { ...initialUser, quota: 10 }
    getSelf.mockResolvedValue({ success: true, data: refreshedUser })

    renderBanner()

    await waitFor(() =>
      expect(useAuthStore.getState().auth.user?.quota).toBe(10)
    )
    expectBannerVisible()
  })

  test('hides after a successful refresh reports a recovered balance', async () => {
    const initialUser = setUser({ quota: 10 })
    const refreshedUser = {
      ...initialUser,
      quota: DEFAULT_QUOTA_WARNING_THRESHOLD + 1,
    }
    getSelf.mockResolvedValue({ success: true, data: refreshedUser })

    renderBanner()

    await waitFor(() =>
      expect(useAuthStore.getState().auth.user?.quota).toBe(
        DEFAULT_QUOTA_WARNING_THRESHOLD + 1
      )
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
