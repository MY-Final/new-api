export interface SubscriptionOverviewTotals {
  order_count: number
  revenue: number
  consumed_quota: number
  consumed_cost: number
  gross_profit: number
  gross_margin: number
  active_subscriptions: number
  capacity_quota: number
  used_quota: number
  remaining_quota: number
  remaining_cost: number
}

export interface SubscriptionOverviewPlan extends SubscriptionOverviewTotals {
  plan_id: number
  title: string
  price_amount: number
  currency: string
  enabled: boolean
}

export interface SubscriptionOverviewData {
  start_timestamp: number
  end_timestamp: number
  upstream_ratio: number
  quota_per_unit: number
  summary: SubscriptionOverviewTotals
  plans: SubscriptionOverviewPlan[]
}

export interface SubscriptionOverviewParams {
  start_timestamp: number
  end_timestamp: number
  upstream_ratio: number
}
