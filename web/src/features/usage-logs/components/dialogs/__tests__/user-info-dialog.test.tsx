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
import { describe, expect, test, vi } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { api } = await import('@/lib/api')
const { formatQuota, formatTimestampToDate } = await import('@/lib/format')
const { UserInfoDialog } = await import('../user-info-dialog')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        Balance: 'Balance',
        'Invitation Code': 'Invitation Code',
        'Invited Users': 'Invited Users',
        'Inviter ID': 'Inviter ID',
        'Affiliate Code': 'Affiliate Code',
        'Historical Affiliate Quota': 'Historical Affiliate Quota',
        'Reversed Affiliate Quota': 'Reversed Affiliate Quota',
        'Request Count': 'Request Count',
        'Used Quota': 'Used Quota',
        'User Group': 'User Group',
        'User Information': 'User Information',
        Username: 'Username',
      },
    },
  },
})

function renderDialog(
  user: Record<string, unknown>,
  options: {
    subscriptions?: Record<string, unknown>[]
    plans?: Record<string, unknown>[]
    userDenied?: boolean
    subscriptionResponses?: Record<string, unknown>[]
    subscriptionPromise?: Promise<Record<string, unknown>>
  } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const subscriptionResponses = options.subscriptionResponses ?? [
    { success: true, data: options.subscriptions ?? [] },
  ]
  const request = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === `/api/user/${user.id}`) {
      return {
        data: options.userDenied
          ? { success: false, message: 'Access denied' }
          : { success: true, data: user },
      }
    }
    if (url === `/api/subscription/admin/users/${user.id}/subscriptions`) {
      if (options.subscriptionPromise) {
        return { data: await options.subscriptionPromise }
      }
      if (subscriptionResponses.length > 1) {
        return { data: subscriptionResponses.shift() }
      }
      return { data: subscriptionResponses[0] }
    }
    if (url === '/api/subscription/admin/plans') {
      return { data: { success: true, data: options.plans ?? [] } }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <UserInfoDialog
          userId={Number(user.id)}
          open
          onOpenChange={() => undefined}
        />
      </I18nextProvider>
    </QueryClientProvider>
  )
  return { ...result, request }
}

function infoValue(label: string) {
  const labelElement = screen.getByText(label, { selector: 'dt' })
  const value = labelElement.parentElement?.querySelector('dd')
  if (!value) {
    throw new Error(`Missing value for ${label}`)
  }
  return value
}

const invitedUser = {
  id: 7,
  username: 'qianchuan',
  email: 'qianchuan@example.test',
  status: 1,
  role: 100,
  quota: 0,
  bonus_quota: 500000,
  paid_quota: 0,
  used_quota: 0,
  request_count: 438,
  group: 'paidGroup',
  max_concurrency: 0,
  aff_code: 'D4Fe',
  aff_count: 0,
  aff_quota: 250000,
  aff_history_quota: 1000000,
  aff_reversed_quota: 500000,
  inviter_id: 39,
  created_at: 1_790_000_000,
  last_login_at: 1_790_100_000,
  github_id: 'github-7',
  linux_do_id: 'linuxdo-7',
  remark: 'VIP account',
}

const activeSubscription = {
  id: 42,
  user_id: 7,
  plan_id: 3,
  status: 'active',
  start_time: 1_790_000_000,
  end_time: 4_102_444_800,
  amount_total: 1_000_000,
  amount_used: 250_000,
}

describe('usage log user info dialog', () => {
  test('shows account, wallet, referral, and binding details', async () => {
    renderDialog(invitedUser)

    expect(await screen.findByText('qianchuan@example.test')).toBeVisible()
    expect(screen.getByText('Super Admin')).toBeVisible()
    expect(screen.getByText('Enabled')).toBeVisible()
    expect(
      screen.getByText(formatTimestampToDate(invitedUser.created_at))
    ).toBeVisible()
    expect(
      screen.getByText(formatTimestampToDate(invitedUser.last_login_at))
    ).toBeVisible()
    expect(screen.getByText('Bonus Balance')).toBeVisible()
    expect(infoValue('Bonus Balance')).toHaveTextContent(
      formatQuota(invitedUser.bonus_quota)
    )
    const accountCard = screen.getByText('Account').closest('[data-slot=card]')
    const walletCard = screen.getByText('Wallet').closest('[data-slot=card]')
    expect(accountCard).toHaveTextContent('Total Usage')
    expect(walletCard).not.toHaveTextContent('Total Usage')
    expect(screen.getByText('Affiliate Code')).toBeVisible()
    expect(screen.getByText('D4Fe')).toBeVisible()
    expect(screen.getByText('Historical Affiliate Quota')).toBeVisible()
    expect(screen.getByText('Reversed Affiliate Quota')).toBeVisible()
    expect(screen.getByText('github-7')).toBeVisible()
    expect(screen.getByText('linuxdo-7')).toBeVisible()
    expect(screen.getByText('VIP account')).toBeVisible()
  })

  test('shows who invited an invited user alongside the users they invited', async () => {
    renderDialog(invitedUser)

    expect(await screen.findByText('Inviter ID')).toBeVisible()
    expect(infoValue('Inviter ID')).toHaveTextContent('39')
    // The two invitation directions stay distinct: the invited count is not
    // replaced by the inviter, and the inviter is not rendered as a count.
    expect(screen.getByText('Invited Users')).toBeVisible()
    expect(infoValue('Invited Users')).toHaveTextContent('0')
  })

  test('renders the full referral section for a user without referral data', async () => {
    renderDialog({
      id: 8,
      username: 'invitee',
      status: 1,
      role: 1,
      quota: 0,
      used_quota: 0,
      request_count: 0,
    })

    expect(await screen.findByText('Inviter ID')).toBeVisible()
    expect(infoValue('Inviter ID')).toHaveTextContent('-')
    expect(infoValue('Invited Users')).toHaveTextContent('-')
  })

  test('hides the inviter when the account was not invited', async () => {
    renderDialog({ ...invitedUser, inviter_id: 0 })

    expect(await screen.findByText('Invited Users')).toBeVisible()
    expect(infoValue('Inviter ID')).toHaveTextContent('-')
  })

  test('shows active subscriptions with each rolling quota window', async () => {
    renderDialog(invitedUser, {
      plans: [
        { plan: { id: 3, title: 'Pro Plan' } },
        { plan: { id: 4, title: 'Old Plan' } },
      ],
      subscriptions: [
        {
          subscription: {
            ...activeSubscription,
            quota_windows: [
              {
                window_seconds: 18_000,
                quota_limit: 500_000,
                used: 100_000,
                remaining: 400_000,
                next_release_at: 1_900_000_000,
              },
              {
                window_seconds: 86_400,
                quota_limit: 1_000_000,
                used: 300_000,
                remaining: 700_000,
                next_release_at: 1_900_010_000,
              },
            ],
          },
        },
        {
          subscription: {
            ...activeSubscription,
            id: 43,
            plan_id: 4,
            end_time: 1_700_000_000,
          },
        },
      ],
    })

    expect(await screen.findByText('Pro Plan')).toBeVisible()
    expect(screen.getByText('Active')).toBeVisible()
    expect(
      screen.getByText(formatTimestampToDate(activeSubscription.end_time))
    ).toBeVisible()
    const fiveHours = screen.getByText('5 hours').parentElement
    const oneDay = screen.getByText('1 days').parentElement
    expect(fiveHours).toHaveTextContent(formatQuota(100_000))
    expect(fiveHours).toHaveTextContent(formatQuota(400_000))
    expect(oneDay).toHaveTextContent(formatQuota(300_000))
    expect(oneDay).toHaveTextContent(formatQuota(700_000))
    expect(screen.queryByText('Old Plan')).not.toBeInTheDocument()
  })

  test('shows remaining quota and unlimited subscriptions without rolling windows', async () => {
    renderDialog(invitedUser, {
      plans: [{ plan: { id: 3, title: 'Legacy Plan' } }],
      subscriptions: [
        { subscription: activeSubscription },
        {
          subscription: {
            ...activeSubscription,
            id: 44,
            plan_id: 5,
            amount_total: 0,
            amount_used: 0,
          },
        },
      ],
    })

    expect(await screen.findByText('Legacy Plan')).toBeVisible()
    expect(screen.getByText(formatQuota(750_000))).toBeVisible()
    expect(screen.getByText('#5')).toBeVisible()
    expect(screen.getAllByText('Unlimited').length).toBeGreaterThan(1)
  })

  test('shows an empty state when all subscriptions are inactive', async () => {
    renderDialog(invitedUser, {
      subscriptions: [
        { subscription: { ...activeSubscription, status: 'cancelled' } },
        {
          subscription: { ...activeSubscription, end_time: 1_700_000_000 },
        },
      ],
    })

    expect(await screen.findByText('No active subscriptions')).toBeVisible()
  })

  test('shows loading until subscription data is available', async () => {
    let resolveSubscriptions!: (response: Record<string, unknown>) => void
    const subscriptionPromise = new Promise<Record<string, unknown>>(
      (resolve) => {
        resolveSubscriptions = resolve
      }
    )
    renderDialog(invitedUser, { subscriptionPromise })

    expect(await screen.findByRole('status')).toHaveTextContent('Loading...')
    expect(
      screen.queryByText('No active subscriptions')
    ).not.toBeInTheDocument()
    await act(async () => {
      resolveSubscriptions({ success: true, data: [] })
      await subscriptionPromise
    })
    expect(await screen.findByText('No active subscriptions')).toBeVisible()
  })

  test('shows a retryable error instead of an empty state when loading fails', async () => {
    const user = userEvent.setup()
    renderDialog(invitedUser, {
      subscriptionResponses: [
        { success: false, message: 'Subscriptions unavailable' },
        { success: true, data: [] },
      ],
    })

    expect(await screen.findByText('Failed to load')).toBeVisible()
    expect(
      screen.queryByText('No active subscriptions')
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No active subscriptions')).toBeVisible()
  })

  test('shows an error when the subscription response has no data', async () => {
    renderDialog(invitedUser, {
      subscriptionResponses: [{ success: true }],
    })

    expect(await screen.findByText('Failed to load')).toBeVisible()
    expect(
      screen.queryByText('No active subscriptions')
    ).not.toBeInTheDocument()
  })

  test('does not label unavailable quota windows as unlimited', async () => {
    renderDialog(invitedUser, {
      plans: [{ plan: { id: 3, title: 'Pro Plan' } }],
      subscriptions: [
        {
          subscription: {
            ...activeSubscription,
            amount_total: 0,
            quota_windows: null,
          },
        },
      ],
    })

    const subscription = await screen.findByRole('region', { name: /Pro Plan/ })
    expect(within(subscription).getByText('Failed to load')).toBeVisible()
    expect(
      within(subscription).queryByText('Unlimited')
    ).not.toBeInTheDocument()
    expect(
      within(subscription).getByRole('button', { name: 'Retry' })
    ).toBeVisible()
  })

  test('does not request subscriptions when user information is forbidden', async () => {
    const { request } = renderDialog(invitedUser, { userDenied: true })

    expect(
      await screen.findByText('Failed to fetch user information')
    ).toBeVisible()
    expect(
      request.mock.calls.some(([url]) =>
        url.startsWith('/api/subscription/admin/')
      )
    ).toBe(false)
    expect(
      screen.queryByRole('button', { name: 'Manage Subscriptions' })
    ).not.toBeInTheDocument()
  })

  test('keeps the selected user when an earlier user request finishes late', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    let resolveFirstUser!: (value: {
      data: { success: boolean; data: typeof invitedUser }
    }) => void
    const firstUser = new Promise<{
      data: { success: boolean; data: typeof invitedUser }
    }>((resolve) => {
      resolveFirstUser = resolve
    })
    const secondUser = {
      ...invitedUser,
      id: 8,
      username: 'second',
      email: 'second@example.test',
    }
    const request = vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/user/7') return firstUser
      if (url === '/api/user/8') {
        return { data: { success: true, data: secondUser } }
      }
      return { data: { success: true, data: [] } }
    })
    const renderUser = (id: number) => (
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <UserInfoDialog userId={id} open onOpenChange={() => undefined} />
        </I18nextProvider>
      </QueryClientProvider>
    )
    const view = render(renderUser(7))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/api/user/7'))
    view.rerender(renderUser(8))
    expect(await screen.findByText('second@example.test')).toBeVisible()

    await act(async () => {
      resolveFirstUser({ data: { success: true, data: invitedUser } })
      await firstUser
    })

    expect(screen.getByText('second@example.test')).toBeVisible()
    expect(screen.queryByText('qianchuan@example.test')).not.toBeInTheDocument()
    expect(
      request.mock.calls.some(
        ([url]) => url === '/api/subscription/admin/users/7/subscriptions'
      )
    ).toBe(false)
  })

  test('opens subscription management for the selected user', async () => {
    const user = userEvent.setup()
    renderDialog(invitedUser, {
      plans: [{ plan: { id: 3, title: 'Pro Plan', currency: 'CNY' } }],
      subscriptions: [{ subscription: activeSubscription }],
    })

    const manageButton = await screen.findByRole('button', {
      name: 'Manage Subscriptions',
    })
    manageButton.focus()
    await user.keyboard('{Enter}')
    const drawer = await screen.findByRole('dialog', {
      name: 'User Subscription Management',
    })
    expect(within(drawer).getByText('qianchuan (ID: 7)')).toBeVisible()
    await waitFor(() =>
      expect(within(drawer).getByText('Pro Plan')).toBeVisible()
    )
    await user.keyboard('{Escape}')
    await waitFor(() => expect(manageButton).toHaveFocus())
  })

  test('refreshes the summary after invalidating a subscription', async () => {
    const user = userEvent.setup()
    const active = { subscription: activeSubscription }
    const cancelled = {
      subscription: { ...activeSubscription, status: 'cancelled' },
    }
    renderDialog(invitedUser, {
      plans: [{ plan: { id: 3, title: 'Pro Plan', currency: 'CNY' } }],
      subscriptionResponses: [
        { success: true, data: [active] },
        { success: true, data: [active] },
        { success: true, data: [cancelled] },
        { success: true, data: [cancelled] },
      ],
    })
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: {} },
    })

    expect(await screen.findByText('Pro Plan')).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Manage Subscriptions' })
    )
    const drawer = await screen.findByRole('dialog', {
      name: 'User Subscription Management',
    })
    await user.click(
      await within(drawer).findByRole('button', { name: 'Actions' })
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'Invalidate' })
    )
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Confirm invalidate',
    })
    await user.click(
      within(confirmation).getByRole('button', { name: 'Continue' })
    )
    await waitFor(() =>
      expect(within(drawer).getByText('Invalidated')).toBeVisible()
    )
    await user.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('No active subscriptions')).toBeVisible()
  })
})
