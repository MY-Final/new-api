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
import { z } from 'zod'

// ============================================================================
// Subscription Plan Schema & Types
// ============================================================================

export const subscriptionQuotaWindowSchema = z.object({
  id: z.number().optional(),
  window_seconds: z.number(),
  quota_limit: z.number(),
  sort_order: z.number().optional().default(0),
})

export type SubscriptionQuotaWindow = z.infer<
  typeof subscriptionQuotaWindowSchema
>

export const subscriptionQuotaWindowUsageSchema =
  subscriptionQuotaWindowSchema.extend({
    used: z.number(),
    reserved: z.number().optional(),
    remaining: z.number(),
    next_release_at: z.number(),
  })

export type SubscriptionQuotaWindowUsage = z.infer<
  typeof subscriptionQuotaWindowUsageSchema
>

export const subscriptionPlanSchema = z.object({
  id: z.number(),
  title: z.string(),
  subtitle: z.string().optional(),
  price_amount: z.number(),
  currency: z.string().default('CNY'),
  duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
  duration_value: z.number(),
  custom_seconds: z.number().optional(),
  quota_reset_period: z.enum(['never', 'daily', 'weekly', 'monthly', 'custom']),
  quota_reset_custom_seconds: z.number().optional(),
  enabled: z.boolean(),
  sort_order: z.number(),
  allow_balance_pay: z.boolean().optional().default(true),
  allow_wallet_overflow: z.boolean().optional().default(true),
  max_purchase_per_user: z.number(),
  max_concurrency: z.number().optional(),
  max_output_tokens: z.number().optional(),
  total_amount: z.number(),
  quota_windows: z.array(subscriptionQuotaWindowSchema).optional(),
  upgrade_group: z.string().optional(),
  route_groups: z.array(z.string()).optional(),
  route_group_ratios: z.record(z.string(), z.number()).optional(),
  downgrade_group: z.string().optional(),
  stripe_price_id: z.string().optional(),
  creem_product_id: z.string().optional(),
  waffo_pancake_product_id: z.string().optional(),
})

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>

export interface PlanRecord {
  plan: SubscriptionPlan
}

// ============================================================================
// User Subscription Schema & Types
// ============================================================================

export const userSubscriptionSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  plan_id: z.number(),
  status: z.string(),
  source: z.string().optional(),
  start_time: z.number(),
  end_time: z.number(),
  amount_total: z.number(),
  amount_used: z.number(),
  amount_reserved: z.number().optional(),
  amount_used_with_reserved: z.number().optional(),
  next_reset_time: z.number().optional(),
  upgrade_group: z.string().optional(),
  route_groups: z.array(z.string()).optional(),
  route_group_ratios: z.record(z.string(), z.number()).optional(),
  downgrade_group: z.string().optional(),
  allow_wallet_overflow: z.boolean().optional(),
  max_concurrency: z.number().optional(),
  max_output_tokens: z.number().optional(),
  quota_windows: z.array(subscriptionQuotaWindowUsageSchema).optional(),
})

export type UserSubscription = z.infer<typeof userSubscriptionSchema>

export interface UserSubscriptionRecord {
  subscription: UserSubscription
}

export interface SubscriptionUsageRecord {
  billing_id: string
  request_id: string
  subscription_id: number
  plan_id: number
  plan_title: string
  model_name: string
  token_id: number
  token_name: string
  channel_id: number
  channel_name: string
  quota: number
  refunded_quota: number
  created_at: number
}

export interface SubscriptionUsageRecordFilters {
  modelName?: string
  subscriptionId?: number
  tokenId?: number
  channelId?: number
}

export interface SubscriptionUsagePeriod {
  start_time: number
  end_time: number
  quota: number
  wallet_quota: number
  subscription_quota: number
  request_count: number
  wallet_request_count: number
  subscription_request_count: number
  refunded_quota: number
  refunded_request_count: number
}

export interface SubscriptionUsageDaily {
  date: string
  quota: number
  wallet_quota: number
  subscription_quota: number
  request_count: number
  wallet_request_count: number
  subscription_request_count: number
  refunded_quota: number
}

export interface SubscriptionUsageSubscriptionOption {
  id: number
  plan_title: string
}

export interface SubscriptionUsageTokenOption {
  id: number
  name: string
}

export interface SubscriptionUsageChannelOption {
  id: number
  name: string
}

export interface SubscriptionUsageFilterOptions {
  models: string[]
  subscriptions: SubscriptionUsageSubscriptionOption[]
  tokens: SubscriptionUsageTokenOption[]
  channels: SubscriptionUsageChannelOption[]
}

export interface SubscriptionPurchaseSpend {
  currency: string
  amount: number
  count: number
}

export interface SubscriptionUsageStatistics {
  used_quota: number
  wallet_used_quota: number
  subscription_used_quota: number
  request_count: number
  wallet_request_count: number
  subscription_request_count: number
  today: SubscriptionUsagePeriod
  last_7_days: SubscriptionUsagePeriod
  last_30_days: SubscriptionUsagePeriod
  daily: SubscriptionUsageDaily[]
  refunded_quota: number
  refunded_request_count: number
  pending_request_count: number
  pending_quota: number
  subscription_purchase_count: number
  subscription_purchase_spend: SubscriptionPurchaseSpend[]
  filter_options: SubscriptionUsageFilterOptions
}

export interface SubscriptionUsagePage {
  page: number
  page_size: number
  total: number
  items: SubscriptionUsageRecord[]
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface PlanPayload {
  plan: Partial<SubscriptionPlan>
}

export interface SubscriptionPayRequest {
  plan_id: number
  payment_method?: string
}

export interface SubscriptionPayResponse {
  success: boolean
  message?: string
  data?: {
    // Stripe-style hosted checkout link.
    pay_link?: string
    // Waffo Pancake / Creem hosted checkout URL.
    checkout_url?: string
    // Pancake-only: order metadata + self-service buyer session token,
    // surfaced for future flows (refund / cancel from new-api's own UI).
    session_id?: string
    expires_at?: number | string
    order_id?: string
    token?: string
    token_expires_at?: number | string
  }
  url?: string
}

export interface SubscriptionBalancePayData {
  renewed: boolean
  end_time: number
  upgrade_group: string
  route_groups: string[]
  route_group_ratios: Record<string, number>
  max_concurrency: number
  max_output_tokens: number
  quota_windows: SubscriptionQuotaWindowUsage[]
  subscription: UserSubscription
}

export interface CreateUserSubscriptionRequest {
  plan_id: number
}

export interface ResetUserSubscriptionsRequest {
  plan_id: number
  advance_reset_time: boolean
}

export interface ResetPlanSubscriptionsRequest {
  advance_reset_time: boolean
}

export interface SubscriptionResetResult {
  plan_id: number
  matched_count: number
  reset_count: number
  user_count: number
  advance_reset_time: boolean
}

// ============================================================================
// Self Subscription Data (user-facing)
// ============================================================================

export interface SelfSubscriptionData {
  billing_preference: string
  subscriptions: UserSubscriptionRecord[]
  all_subscriptions: UserSubscriptionRecord[]
}

// ============================================================================
// Dialog Types
// ============================================================================

export type SubscriptionsDialogType =
  | 'create'
  | 'update'
  | 'grant-subscription'
  | 'toggle-status'
  | 'reset-subscriptions'
  | 'delete-plan'
