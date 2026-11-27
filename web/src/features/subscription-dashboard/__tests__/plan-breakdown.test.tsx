import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { PlanBreakdown } from '../components/plan-breakdown'
import type { SubscriptionOverviewPlan } from '../types'

const BASE_PLAN: SubscriptionOverviewPlan = {
  plan_id: 1,
  title: 'Coding monthly',
  price_amount: 30,
  price_amount_usd: 30,
  currency: 'USD',
  currency_supported: true,
  enabled: true,
  configured_quota_usd: 4.11,
  quota_below_price: true,
  order_count: 2,
  revenue_usd: 30,
  cash_revenue_usd: 20,
  balance_revenue_usd: 10,
  consumed_quota: 9600,
  consumed_cost_usd: 0.00234,
  unattributed_quota: 1800,
  gross_profit_usd: 29.5,
  gross_margin: 0.983333,
  active_subscriptions: 1,
  unlimited_subscriptions: 0,
  capacity_quota: 2054795,
  used_quota: 9600,
  reserved_quota: 0,
  remaining_quota: 2045195,
  remaining_cost_usd: 0.6135585,
  remaining_cost_ratio: 0.15,
  remaining_cost_ratio_source: 'consumption',
  unconfigured_cost_ratio_groups: [],
  groups: [
    {
      group_name: 'codex-pro',
      consumed_quota: 6000,
      consumed_cost_usd: 0.0018,
      unattributed_quota: 0,
      effective_cost_ratio: 0.15,
      cost_share: 0.769231,
      cost_ratio_source: 'snapshot',
    },
    {
      group_name: 'kiro-cc',
      consumed_quota: 3600,
      consumed_cost_usd: 0.00054,
      unattributed_quota: 1800,
      effective_cost_ratio: 0.15,
      cost_share: 0.230769,
      cost_ratio_source: 'partial',
    },
  ],
}

afterEach(() => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG },
  })
})

describe('subscription plan breakdown', () => {
  test('shows cash and balance revenue separately from total revenue', () => {
    render(<PlanBreakdown plans={[BASE_PLAN]} loading={false} />)

    expect(screen.getByText('🥚 30')).toBeInTheDocument()
    expect(screen.getByText(/Cash 🥚 20 · Balance 🥚 10/)).toBeInTheDocument()
  })

  test('flags a plan whose quota value is below its price', () => {
    render(<PlanBreakdown plans={[BASE_PLAN]} loading={false} />)

    expect(
      screen.getByText('Quota below price at current exchange rate')
    ).toBeInTheDocument()
    expect(screen.getByText(/Quota value: 🥚 4.11/)).toBeInTheDocument()
  })

  test('flags revenue excluded because the plan currency is unsupported', () => {
    render(
      <PlanBreakdown
        plans={[
          {
            ...BASE_PLAN,
            currency: 'EUR',
            currency_supported: false,
            revenue_usd: 0,
          },
        ]}
        loading={false}
      />
    )

    expect(
      screen.getByText('Revenue excluded: unsupported currency')
    ).toBeInTheDocument()
  })

  test('expands a plan to show settled cost by route group', () => {
    render(<PlanBreakdown plans={[BASE_PLAN]} loading={false} />)

    const toggle = screen.getByRole('button', {
      name: 'Show route group costs',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('codex-pro')).toBeInTheDocument()
    expect(screen.getByText('kiro-cc')).toBeInTheDocument()
    expect(screen.getByText('Snapshot')).toBeInTheDocument()
    expect(screen.getByText('Partial')).toBeInTheDocument()
    expect(screen.getAllByText('0.15×').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText(/Unattributed/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('76.92%')).toBeInTheDocument()
    expect(screen.getByText('23.08%')).toBeInTheDocument()
  })

  test('flags route groups without a cost ratio instead of estimating them', () => {
    render(
      <PlanBreakdown
        plans={[
          {
            ...BASE_PLAN,
            consumed_quota: 0,
            consumed_cost_usd: 0,
            unattributed_quota: 0,
            remaining_cost_ratio: 0,
            remaining_cost_ratio_source: 'unconfigured',
            unconfigured_cost_ratio_groups: ['kiro-cc'],
            groups: [],
          },
        ]}
        loading={false}
      />
    )

    expect(
      screen.getByText(/Upstream cost ratio is not configured for: kiro-cc/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Unconfigured/)).toBeInTheDocument()
  })
})
