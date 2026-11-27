import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getSubscriptionPlanSubscribers } from '../api'
import { PlanSubscribersDialog } from '../components/plan-subscribers-dialog'
import type { SubscriptionOverviewPlan } from '../types'

vi.mock('../api', () => ({
  getSubscriptionPlanSubscribers: vi.fn(),
}))

const mockGetSubscribers = vi.mocked(getSubscriptionPlanSubscribers)

const SAMPLE_PLAN: SubscriptionOverviewPlan = {
  plan_id: 7,
  title: 'GPT Coding Monthly · Lite',
  price_amount: 30,
  price_amount_usd: 30,
  currency: 'CNY',
  currency_supported: true,
  enabled: true,
  configured_quota_usd: 152,
  quota_below_price: false,
  order_count: 2,
  revenue_usd: 60,
  cash_revenue_usd: 0,
  balance_revenue_usd: 60,
  consumed_quota: 1000,
  consumed_cost_usd: 0.15,
  unattributed_quota: 0,
  gross_profit_usd: 59.85,
  gross_margin: 0.9975,
  active_subscriptions: 1,
  unlimited_subscriptions: 0,
  capacity_quota: 76000000,
  used_quota: 1000,
  reserved_quota: 0,
  remaining_quota: 75999000,
  remaining_cost_usd: 22.8,
  remaining_cost_ratio: 0.15,
  remaining_cost_ratio_source: 'consumption',
  unconfigured_cost_ratio_groups: [],
  groups: [],
}

function renderDialog(open = true) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanSubscribersDialog
        plan={SAMPLE_PLAN}
        open={open}
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetSubscribers.mockReset()
})

describe('PlanSubscribersDialog', () => {
  test('renders subscriber list and forwards search keyword', async () => {
    mockGetSubscribers.mockResolvedValue({
      success: true,
      data: {
        plan_id: 7,
        plan_title: 'GPT Coding Monthly · Lite',
        total: 1,
        page: 1,
        page_size: 15,
        active_count: 1,
        items: [
          {
            id: 101,
            user_id: 42,
            username: 'alice',
            display_name: 'Alice Lin',
            email: 'alice@example.com',
            status: 'active',
            effective_status: 'active',
            source: 'order',
            amount_total: 5000000,
            amount_used: 1000000,
            amount_reserved: 0,
            start_time: 1793200000,
            end_time: 1795800000,
            last_reset_time: 0,
            next_reset_time: 0,
          },
        ],
      },
    })

    renderDialog(true)

    await waitFor(() => {
      expect(screen.getByText('Alice Lin')).toBeInTheDocument()
    })
    expect(screen.getByText(/@alice · #42/)).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()

    const input = screen.getByPlaceholderText(
      'Search username, email, or user ID'
    )
    fireEvent.change(input, { target: { value: 'alice' } })
    const form = input.closest('form')
    expect(form).not.toBeNull()
    if (form) {
      fireEvent.submit(form)
    }

    await waitFor(() => {
      expect(mockGetSubscribers).toHaveBeenLastCalledWith(7, {
        page: 1,
        page_size: 15,
        status: undefined,
        keyword: 'alice',
      })
    })
  })

  test('shows empty state when no subscribers match', async () => {
    mockGetSubscribers.mockResolvedValue({
      success: true,
      data: {
        plan_id: 7,
        plan_title: 'GPT Coding Monthly · Lite',
        total: 0,
        page: 1,
        page_size: 15,
        active_count: 0,
        items: [],
      },
    })

    renderDialog(true)

    await waitFor(() => {
      expect(screen.getByText('No subscribers found')).toBeInTheDocument()
    })
  })
})
