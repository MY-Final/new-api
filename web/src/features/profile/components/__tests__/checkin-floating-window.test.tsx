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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'
import type {
  ApiResponse,
  CheckinStats,
  CheckinStatusResponse,
} from '@/features/profile/types'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { CheckinFloatingWindow } from '../checkin-floating-window'

const getCheckinStatus = vi.hoisted(() => vi.fn())
const performCheckin = vi.hoisted(() => vi.fn())
const useStatus = vi.hoisted(() => vi.fn())
/** Mutable route so one test can mount the window on the profile page. */
const currentPath = vi.hoisted(() => ({ value: '/dashboard' }))

vi.mock('@/features/profile/api', () => ({ getCheckinStatus, performCheckin }))
vi.mock('@/hooks/use-status', () => ({ useStatus }))
vi.mock('@/components/turnstile', () => ({
  Turnstile: (props: { onVerify: (token: string) => void }) => (
    <button type='button' onClick={() => props.onVerify('turnstile-token')}>
      solve-turnstile
    </button>
  ),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: (options?: {
    select?: (location: { pathname: string }) => unknown
  }) => {
    const location = { pathname: currentPath.value }
    return options?.select ? options.select(location) : location
  },
}))

const enabledStatus = {
  checkin_enabled: true,
  turnstile_check: false,
  turnstile_site_key: '',
} as SystemStatus

const baseStats: CheckinStats = {
  checked_in_today: false,
  total_checkins: 12,
  total_quota: 120_000,
  checkin_count: 3,
  records: [],
}

function checkinStatus(
  overrides?: Partial<CheckinStats>
): ApiResponse<CheckinStatusResponse> {
  return {
    success: true,
    data: {
      enabled: true,
      min_quota: 1000,
      max_quota: 10_000,
      stats: { ...baseStats, ...overrides },
    },
  }
}

const queryClients: QueryClient[] = []
const initialCurrency = { ...useSystemConfigStore.getState().config.currency }

function renderCheckinWindow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClients.push(queryClient)

  return render(
    <QueryClientProvider client={queryClient}>
      <CheckinFloatingWindow />
    </QueryClientProvider>
  )
}

function checkinWindow() {
  return screen.queryByRole('complementary', { name: 'Daily Check-in' })
}

beforeEach(() => {
  getCheckinStatus.mockReset()
  performCheckin.mockReset()
  useStatus.mockReset()
  currentPath.value = '/dashboard'
  localStorage.clear()
  useSystemConfigStore.getState().setConfig({ currency: initialCurrency })
  useStatus.mockReturnValue({
    status: enabledStatus,
    loading: false,
    error: null,
  })
})

afterEach(async () => {
  for (const queryClient of queryClients) queryClient.clear()
  queryClients.length = 0
  currentPath.value = '/dashboard'
  localStorage.clear()
  useSystemConfigStore.getState().setConfig({ currency: initialCurrency })
  await i18next.changeLanguage('en')
})

describe('CheckinFloatingWindow', () => {
  test('shows the reward prominently with check-in and earnings totals', async () => {
    getCheckinStatus.mockResolvedValue(checkinStatus())

    renderCheckinWindow()

    const reward = await screen.findByRole('region', { name: 'Reward range' })
    expect(reward).toHaveTextContent(
      `${formatQuotaWithCurrency(1000)} - ${formatQuotaWithCurrency(10_000)}`
    )
    expect(
      screen.getByText('Total check-ins').closest('div')
    ).toHaveTextContent('12')
    expect(screen.getByText('Total earned').closest('div')).toHaveTextContent(
      formatQuotaWithCurrency(120_000)
    )
    expect(checkinWindow()).toHaveStyle({ width: '336px' })
  })

  test('keeps long reward amounts wrappable in a narrow viewport', async () => {
    vi.stubGlobal('innerWidth', 320)
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...initialCurrency,
        quotaDisplayType: 'CUSTOM',
        customCurrencySymbol: 'Reward credits ',
      },
    })
    getCheckinStatus.mockResolvedValue(checkinStatus())

    try {
      renderCheckinWindow()

      const reward = await screen.findByRole('region', { name: 'Reward range' })
      expect(checkinWindow()).toHaveStyle({ width: '304px' })
      expect(
        within(reward).getByText(
          `${formatQuotaWithCurrency(1000)} - ${formatQuotaWithCurrency(10_000)}`
        )
      ).toHaveClass('wrap-anywhere')
      expect(screen.getByRole('button', { name: 'View calendar' })).toHaveClass(
        'whitespace-normal'
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('updates displayed rewards when the site currency changes', async () => {
    getCheckinStatus.mockResolvedValue(checkinStatus())
    renderCheckinWindow()
    await screen.findByRole('region', { name: 'Reward range' })

    act(() => {
      useSystemConfigStore.getState().setConfig({
        currency: {
          ...initialCurrency,
          quotaDisplayType: 'CUSTOM',
          customCurrencySymbol: 'Credits ',
        },
      })
    })

    expect(
      screen.getByRole('region', { name: 'Reward range' })
    ).toHaveTextContent(
      `${formatQuotaWithCurrency(1000)} - ${formatQuotaWithCurrency(10_000)}`
    )
    expect(screen.getByText('Total earned').closest('div')).toHaveTextContent(
      formatQuotaWithCurrency(120_000)
    )
  })

  test.each([
    ['zhCN', '1,234'],
    ['zhTW', '1,234'],
    ['en', '1,234'],
    ['fr', '1\u202f234'],
    ['ja', '1,234'],
    ['ru', '1\u00a0234'],
    ['vi', '1.234'],
    ['invalid_locale', '1,234'],
  ])(
    'formats check-in totals after switching to %s',
    async (language, total) => {
      getCheckinStatus.mockResolvedValue(
        checkinStatus({ total_checkins: 1234 })
      )
      renderCheckinWindow()
      await screen.findByRole('region', { name: 'Reward range' })

      await act(async () => {
        await i18next.changeLanguage(language)
      })

      expect(
        screen.getByText('Total check-ins').nextElementSibling?.textContent
      ).toBe(total)
    }
  )

  test('disables the claim button and exposes its loading state during submission', async () => {
    getCheckinStatus.mockResolvedValue(checkinStatus())
    let resolveCheckin!: (
      response: ApiResponse<{ quota_awarded: number; checkin_date: string }>
    ) => void
    performCheckin.mockReturnValue(
      new Promise((resolve) => {
        resolveCheckin = resolve
      })
    )
    renderCheckinWindow()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Check in now' })
    )

    const loadingButton = screen.getByRole('button', { name: 'Loading...' })
    expect(loadingButton).toBeDisabled()
    expect(loadingButton).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      resolveCheckin({
        success: true,
        data: { quota_awarded: 5000, checkin_date: '2026-10-16' },
      })
    })
  })

  test('can be collapsed and reopened using keyboard controls', async () => {
    getCheckinStatus.mockResolvedValue(checkinStatus())
    renderCheckinWindow()
    await screen.findByRole('button', { name: 'Check in now' })

    screen.getByRole('button', { name: 'Collapse panel' }).focus()
    await userEvent.keyboard('{Enter}')

    expect(checkinWindow()).not.toBeInTheDocument()
    screen.getByRole('button', { name: 'Expand panel' }).focus()
    await userEvent.keyboard('{Enter}')

    expect(checkinWindow()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check in now' })).toBeEnabled()
  })

  test('stays hidden when the check-in feature is disabled', () => {
    useStatus.mockReturnValue({
      status: { checkin_enabled: false } as SystemStatus,
      loading: false,
      error: null,
    })
    getCheckinStatus.mockResolvedValue(checkinStatus())

    renderCheckinWindow()

    expect(checkinWindow()).not.toBeInTheDocument()
  })

  test("offers today's check-in and disappears once the reward is claimed", async () => {
    getCheckinStatus
      .mockResolvedValueOnce(checkinStatus())
      .mockResolvedValueOnce(checkinStatus({ checked_in_today: true }))
    performCheckin.mockResolvedValue({
      success: true,
      data: { quota_awarded: 5000, checkin_date: '2026-10-14' },
    })

    renderCheckinWindow()

    const checkinButton = await screen.findByRole('button', {
      name: 'Check in now',
    })
    expect(
      screen.getByRole('button', { name: 'View calendar' })
    ).toHaveAttribute('href', '/profile')

    await userEvent.click(checkinButton)

    await waitFor(() => expect(performCheckin).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    )
  })

  test('stays hidden for the rest of the day after the user closes it', async () => {
    getCheckinStatus.mockResolvedValue(checkinStatus())

    const rendered = renderCheckinWindow()
    await screen.findByRole('button', { name: 'Check in now' })
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }))

    await waitFor(() => expect(checkinWindow()).not.toBeInTheDocument())
    rendered.unmount()

    renderCheckinWindow()
    await waitFor(() => expect(getCheckinStatus).toHaveBeenCalledTimes(2))

    expect(checkinWindow()).not.toBeInTheDocument()
  })

  test('stays hidden on the profile page where the full calendar is shown', async () => {
    currentPath.value = '/profile'
    getCheckinStatus.mockResolvedValue(checkinStatus())

    renderCheckinWindow()

    await waitFor(() => expect(getCheckinStatus).toHaveBeenCalledTimes(1))
    expect(checkinWindow()).not.toBeInTheDocument()
  })

  test('asks for the security check when the server rejects an unverified check-in', async () => {
    useStatus.mockReturnValue({
      status: {
        checkin_enabled: true,
        turnstile_check: true,
        turnstile_site_key: 'site-key',
      } as SystemStatus,
      loading: false,
      error: null,
    })
    getCheckinStatus.mockResolvedValue(checkinStatus())
    performCheckin
      .mockResolvedValueOnce({
        success: false,
        message: 'Turnstile token 为空',
      })
      .mockResolvedValueOnce({
        success: true,
        data: { quota_awarded: 5000, checkin_date: '2026-10-14' },
      })

    renderCheckinWindow()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Check in now' })
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'solve-turnstile' })
    )

    await waitFor(() =>
      expect(performCheckin).toHaveBeenLastCalledWith('turnstile-token')
    )
  })
})
