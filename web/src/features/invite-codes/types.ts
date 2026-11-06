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
export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  code?: string
  data?: T
}

export interface PageData<T> {
  page: number
  page_size: number
  total: number
  items: T[]
}

export interface InviteCode {
  id: number
  name: string
  code: string
  enabled: boolean
  group: string
  inviter_id: number
  registration_limit: number
  registered_count: number
  remaining_registrations: number
  bonus_quota: number
  expires_at: number
  remark: string
  created_at: number
  updated_at: number
}

export interface InviteCodeClaim {
  user_id: number
  username: string
  display_name: string
  email: string
  group: string
  inviter_id: number
  bonus_quota: number
  user_status: number
  user_created_at: number
  claimed_at: number
}

export interface InviteCodeListParams {
  p: number
  page_size: number
  keyword?: string
  enabled?: boolean
}

export interface InviteCodePayload {
  name?: string
  code?: string
  enabled?: boolean
  group?: string
  inviter_id?: number
  registration_limit?: number
  bonus_quota?: number
  expires_at?: number
  remark?: string
}

export interface PublicInviteCode {
  name: string
  code: string
  available: boolean
  reason?: 'disabled' | 'expired' | 'registration_full'
  registration_limit: number
  registered_count: number
  remaining_registrations: number
  bonus_quota: number
  expires_at: number
}
