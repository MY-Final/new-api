import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { expect, test, vi } from 'vitest'

import type {
  PlanRecord,
  SelfSubscriptionData,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import en from '@/i18n/locales/en.json'
import { api } from '@/lib/api'

import { SubscriptionPlansCard } from '../subscription-plans-card'

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en },
  interpolation: { escapeValue: false },
})

const plan: PlanRecord = {
  plan: {
    id: 3,
    title: 'Professional',
    price_amount: 5,
    currency: 'CNY',
    duration_unit: 'month',
    duration_value: 1,
    quota_reset_period: 'never',
    enabled: true,
    sort_order: 0,
    allow_balance_pay: true,
    allow_wallet_overflow: true,
    max_purchase_per_user: 0,
    total_amount: 1_000_000,
  },
}

const active: UserSubscriptionRecord = {
  subscription: {
    id: 42,
    user_id: 7,
    plan_id: 3,
    status: 'active',
    start_time: 1_700_000_000,
    end_time: 4_102_444_800,
    amount_total: 1_000_000,
    amount_used: 250_000,
  },
}

const expired: UserSubscriptionRecord = {
  subscription: {
    ...active.subscription,
    id: 43,
    end_time: 1_700_000_000,
  },
}

const empty: SelfSubscriptionData = {
  billing_preference: 'subscription_only',
  subscriptions: [],
  all_subscriptions: [],
}

async function renderPlans(
  options: {
    plans?: PlanRecord[]
    responses?: SelfSubscriptionData[]
  } = {}
) {
  const responses = [...(options.responses ?? [empty])]
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/subscription/plans') {
      return { data: { success: true, data: options.plans ?? [plan] } }
    }
    if (url === '/api/subscription/self') {
      const data = responses.length > 1 ? responses.shift() : responses[0]
      return { data: { success: true, data } }
    }
    if (url === '/api/subscription/self/usage/stats') {
      return { data: { success: false, message: 'Unavailable' } }
    }
    if (url === '/api/subscription/self/usage') {
      return {
        data: { success: true, data: { page: 1, total: 0, items: [] } },
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <SubscriptionPlansCard topupInfo={null} userQuota={10_000_000} />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

test('shows all subscriptions in a separate responsive area without inner scrolling', async () => {
  const second = {
    subscription: { ...active.subscription, id: 44 },
  }
  await renderPlans({
    responses: [
      {
        billing_preference: 'subscription_first',
        subscriptions: [active, second],
        all_subscriptions: [active, second, expired],
      },
    ],
  })

  const area = await screen.findByRole('region', { name: 'My Subscriptions' })
  expect(
    within(area).getByText('Professional · Subscription #42')
  ).toBeVisible()
  expect(
    within(area).getByText('Professional · Subscription #44')
  ).toBeVisible()
  expect(
    within(area).getByText('Professional · Subscription #43')
  ).toBeVisible()
  expect(within(area).getByText('Expired')).toBeVisible()
  expect(area).not.toContainElement(screen.getByText('Subscription Plans'))
  expect(
    area.querySelector('[class*="overflow-y-auto"], [class*="max-h-"]')
  ).not.toBeInTheDocument()
  const cards = within(area).getAllByRole('article')
  expect(cards).toHaveLength(3)
  expect(cards[0].parentElement).toHaveClass('grid-cols-1', 'lg:grid-cols-2')
  expect(
    within(area).getByRole('button', { name: 'Usage Records' })
  ).toBeVisible()
})

test('keeps expired subscriptions and the inactive preference warning visible', async () => {
  await renderPlans({
    plans: [],
    responses: [{ ...empty, all_subscriptions: [expired] }],
  })

  const area = await screen.findByRole('region', { name: 'My Subscriptions' })
  expect(within(area).getByText('Subscription #43')).toBeVisible()
  expect(within(area).getByText('Expired')).toBeVisible()
  expect(within(area).getByText(/Requests will be rejected/)).toBeVisible()
  expect(screen.getByText('No plans available')).toBeVisible()
})

test('lets a single subscription and its long name use the available width', async () => {
  const title = 'Professional subscription with a particularly long plan name'
  await renderPlans({
    plans: [{ plan: { ...plan.plan, title } }],
    responses: [
      {
        billing_preference: 'subscription_first',
        subscriptions: [active],
        all_subscriptions: [active],
      },
    ],
  })

  const area = await screen.findByRole('region', { name: 'My Subscriptions' })
  expect(within(area).getByText(`${title} · Subscription #42`)).toHaveClass(
    'break-words'
  )
  expect(within(area).getByRole('article').parentElement).not.toHaveClass(
    'lg:grid-cols-2'
  )
})

test('keeps billing preferences editable when no plans or subscriptions exist', async () => {
  const user = userEvent.setup()
  const preference = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { billing_preference: 'wallet_only' } },
  })
  await renderPlans({ plans: [] })

  expect(await screen.findByText('No plans available')).toBeVisible()
  expect(screen.queryByRole('region', { name: 'My Subscriptions' })).toBeNull()
  expect(screen.getByText(/Requests will be rejected/)).toBeVisible()
  await user.click(screen.getByRole('combobox'))
  await user.click(screen.getByRole('option', { name: 'Wallet Only' }))
  await waitFor(() =>
    expect(preference).toHaveBeenCalledWith(
      '/api/subscription/self/preference',
      {
        billing_preference: 'wallet_only',
      }
    )
  )
  expect(
    screen.queryByText(/Requests will be rejected/)
  ).not.toBeInTheDocument()
})

test('shows the new subscription after a successful purchase', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { renewed: false } },
  })
  await renderPlans({
    responses: [
      empty,
      {
        billing_preference: 'subscription_first',
        subscriptions: [active],
        all_subscriptions: [active],
      },
    ],
  })

  await user.click(await screen.findByRole('button', { name: 'Subscribe Now' }))
  const dialog = screen.getByRole('dialog', { name: 'Purchase Subscription' })
  await user.click(
    within(dialog).getByRole('button', { name: 'Pay with Balance' })
  )
  const area = await screen.findByRole('region', { name: 'My Subscriptions' })
  expect(
    within(area).getByText('Professional · Subscription #42')
  ).toBeVisible()
})

test('refreshes subscription details and opens usage records', async () => {
  const user = userEvent.setup()
  await renderPlans({
    responses: [
      {
        billing_preference: 'subscription_first',
        subscriptions: [active],
        all_subscriptions: [active],
      },
      {
        billing_preference: 'subscription_first',
        subscriptions: [active],
        all_subscriptions: [active, expired],
      },
    ],
  })

  const area = await screen.findByRole('region', { name: 'My Subscriptions' })
  await user.click(within(area).getByRole('button', { name: 'Refresh' }))
  expect(
    await within(area).findByText('Professional · Subscription #43')
  ).toBeVisible()
  await user.click(within(area).getByRole('button', { name: 'Usage Records' }))
  expect(
    await screen.findByRole('dialog', { name: 'Subscription Usage' })
  ).toBeVisible()
})
