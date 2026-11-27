export interface SubscriptionOverviewTotals {
  order_count: number
  revenue_usd: number
  cash_revenue_usd: number
  balance_revenue_usd: number
  consumed_quota: number
  consumed_cost_usd: number
  unattributed_quota: number
  gross_profit_usd: number
  gross_margin: number
  active_subscriptions: number
  unlimited_subscriptions: number
  capacity_quota: number
  used_quota: number
  reserved_quota: number
  remaining_quota: number
  remaining_cost_usd: number
}

export interface SubscriptionOverviewPlan extends SubscriptionOverviewTotals {
  plan_id: number
  title: string
  price_amount: number
  price_amount_usd: number
  currency: string
  currency_supported: boolean
  enabled: boolean
  configured_quota_usd: number
  quota_below_price: boolean
  remaining_cost_ratio: number
  remaining_cost_ratio_source:
    | 'consumption'
    | 'configured'
    | 'partial'
    | 'unconfigured'
  unconfigured_cost_ratio_groups: string[]
  groups: SubscriptionOverviewGroup[]
}

export interface SubscriptionOverviewGroup {
  group_name: string
  consumed_quota: number
  consumed_cost_usd: number
  unattributed_quota: number
  effective_cost_ratio: number
  cost_share: number
  cost_ratio_source: 'snapshot' | 'partial' | 'unattributed'
}

export interface SubscriptionOverviewData {
  start_timestamp: number
  end_timestamp: number
  quota_per_unit: number
  has_unsupported_currency: boolean
  summary: SubscriptionOverviewTotals
  plans: SubscriptionOverviewPlan[]
}

export interface SubscriptionOverviewParams {
  start_timestamp: number
  end_timestamp: number
}

export type SubscriberStatusFilter = 'all' | 'active' | 'expired' | 'cancelled'

export interface SubscriptionPlanSubscriber {
  id: number
  user_id: number
  username: string
  display_name: string
  email: string
  status: string
  effective_status: 'active' | 'expired' | 'cancelled' | string
  source: string
  amount_total: number
  amount_used: number
  amount_reserved: number
  start_time: number
  end_time: number
  last_reset_time: number
  next_reset_time: number
}

export interface SubscriptionPlanSubscribersData {
  plan_id: number
  plan_title: string
  total: number
  page: number
  page_size: number
  active_count: number
  items: SubscriptionPlanSubscriber[]
}

export interface SubscriptionPlanSubscribersParams {
  page: number
  page_size: number
  status?: Exclude<SubscriberStatusFilter, 'all'>
  keyword?: string
}
