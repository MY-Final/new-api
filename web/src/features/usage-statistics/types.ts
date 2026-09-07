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
import type {
  UserUsageAggregate,
  UserUsageRequest,
} from '@/features/users/types'

export interface UserUsageRank {
  user_id: number
  username: string
  request_count: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  user_cost: number
  consumed_quota: number
  refunded_quota: number
  net_quota: number
}

export interface UserUsageActivity {
  dau: number
  wau: number
  mau: number
}

export interface UserUsageRanking {
  summary: UserUsageAggregate
  activity: UserUsageActivity
  items: UserUsageRank[]
  total: number
  page: number
  page_size: number
}

export interface UserUsageRequests {
  items: UserUsageRequest[]
  total: number
  page: number
  page_size: number
}

export type {
  UserUsage,
  UserUsageAggregate,
  UserUsageDaily,
  UserUsageModel,
  UserUsageRequest,
} from '@/features/users/types'
