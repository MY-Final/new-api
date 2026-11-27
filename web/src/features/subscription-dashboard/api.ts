import { api } from '@/lib/api'

import type {
  SubscriptionOverviewData,
  SubscriptionOverviewParams,
  SubscriptionPlanSubscribersData,
  SubscriptionPlanSubscribersParams,
} from './types'

interface ApiResponse<T> {
  success: boolean
  message?: string
  data?: T
}

export async function getSubscriptionOverview(
  params: SubscriptionOverviewParams
): Promise<ApiResponse<SubscriptionOverviewData>> {
  const res = await api.get('/api/subscription/admin/overview', { params })
  return res.data
}

export async function getSubscriptionPlanSubscribers(
  planId: number,
  params: SubscriptionPlanSubscribersParams
): Promise<ApiResponse<SubscriptionPlanSubscribersData>> {
  const res = await api.get(
    `/api/subscription/admin/plans/${planId}/subscriptions`,
    { params }
  )
  return res.data
}
