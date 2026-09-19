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
export interface QuotaLedgerDailyItem {
  user_id: number
  username: string
  date: string
  bonus_quota: number
  paid_quota: number
  updated_at: number
}

export interface QuotaLedgerRangeSummary {
  bonus_quota: number
  paid_quota: number
  quota: number
}

export interface QuotaLedgerDailyPage {
  items: QuotaLedgerDailyItem[]
  total: number
  summary: QuotaLedgerRangeSummary
}

export interface QuotaLedgerSummary {
  total_consumed_quota: number
  remaining_quota: number
  remaining_bonus_quota: number
  remaining_paid_quota: number
  range_quota: number
  range_bonus_quota: number
  range_paid_quota: number
  debt_users: number
  debt_quota: number
  today_checkin_bonus: number
  today_checkin_users: number
}

export interface LedgerFilters {
  page: number
  pageSize: number
  startDate: string
  endDate: string
  username: string
}
