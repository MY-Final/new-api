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
import dayjs from 'dayjs'
import i18next from 'i18next'

import { api } from '@/lib/api'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

import type {
  LedgerFilters,
  QuotaLedgerDailyPage,
  QuotaLedgerSummary,
} from './types'

interface ApiResponse<T> {
  success: boolean
  message?: string
  data?: T
}

export function createDefaultLedgerFilters(): LedgerFilters {
  const today = dayjs().format('YYYY-MM-DD')
  return {
    page: 1,
    pageSize: 20,
    startDate: today,
    endDate: today,
    username: '',
  }
}

export async function getQuotaLedgerDaily(
  filters: LedgerFilters
): Promise<QuotaLedgerDailyPage> {
  const response = await api.get<ApiResponse<QuotaLedgerDailyPage>>(
    '/api/ledger/daily',
    {
      params: {
        start_date: filters.startDate,
        end_date: filters.endDate,
        username: filters.username || undefined,
        p: filters.page,
        page_size: filters.pageSize,
      },
    }
  )
  const payload = requireServerSuccess(response.data)
  if (!payload.data) {
    throw createServerError(payload, i18next.t('Failed to load ledger records'))
  }
  return payload.data
}

export async function getQuotaLedgerSummary(
  filters: LedgerFilters
): Promise<QuotaLedgerSummary> {
  const response = await api.get<ApiResponse<QuotaLedgerSummary>>(
    '/api/ledger/summary',
    {
      params: {
        start_date: filters.startDate,
        end_date: filters.endDate,
      },
    }
  )
  const payload = requireServerSuccess(response.data)
  if (!payload.data) {
    throw createServerError(payload, i18next.t('Failed to load ledger summary'))
  }
  return payload.data
}
