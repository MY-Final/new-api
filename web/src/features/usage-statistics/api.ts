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
import { api } from '@/lib/api'

import type { UserUsage, UserUsageRanking, UserUsageRequests } from './types'

export interface UsageStatisticsParams {
  start_timestamp: number
  end_timestamp: number
  p?: number
  page_size?: number
  sort_by?: 'user_cost' | 'total_tokens' | 'request_count'
  username?: string
  model_name?: string
  channel?: number
}

export async function getAdminUserUsageRanking(params: UsageStatisticsParams) {
  const response = await api.get<{
    success: boolean
    message?: string
    data?: UserUsageRanking
  }>('/api/statistics/users/', { params })
  return response.data
}

export async function getAdminUserUsage(
  userId: number,
  params: UsageStatisticsParams
) {
  const response = await api.get<{
    success: boolean
    message?: string
    data?: UserUsage
  }>(`/api/statistics/users/${userId}`, { params })
  return response.data
}

export async function getUserUsageRequests(
  endpoint: string,
  params: UsageStatisticsParams
) {
  const response = await api.get<{
    success: boolean
    message?: string
    data?: UserUsageRequests
  }>(endpoint, { params })
  return response.data
}

export async function getMyUsage(params: UsageStatisticsParams) {
  const response = await api.get<{
    success: boolean
    message?: string
    data?: UserUsage
  }>('/api/statistics/my/', { params })
  return response.data
}
