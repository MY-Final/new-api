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
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

import type {
  FinanceFilters,
  FinanceRebate,
  FinanceRedemption,
  FinanceTopup,
  FinancialOperation,
  PageData,
  RequestBilling,
  RefundBatch,
  RefundQueueFilters,
  ManualCreditInput,
} from './types'

interface ApiResponse<T> {
  success: boolean
  message?: string
  data?: T
}

function queryParams(filters: FinanceFilters) {
  return {
    p: filters.page,
    page_size: filters.pageSize,
    keyword: filters.keyword || undefined,
    user_id: filters.userId || undefined,
    inviter_id: filters.inviterId || undefined,
    invitee_id: filters.inviteeId || undefined,
    operator_id: filters.operatorId || undefined,
    source_type: filters.sourceType || undefined,
    status: filters.status || undefined,
    provider: filters.provider || undefined,
    operation_type: filters.operationType || undefined,
    start_time: filters.startTime || undefined,
    end_time: filters.endTime || undefined,
  }
}

async function getPage<T>(path: string, filters: FinanceFilters) {
  const response = await api.get<ApiResponse<PageData<T>>>(path, {
    params: queryParams(filters),
  })
  const payload = requireServerSuccess(response.data)
  return payload.data || { items: [], total: 0 }
}

export const getFinanceTopups = (filters: FinanceFilters) =>
  getPage<FinanceTopup>('/api/finance/topups', filters)

export const getFinanceRedemptions = (filters: FinanceFilters) =>
  getPage<FinanceRedemption>('/api/finance/redemptions', filters)

export const getFinanceRebates = (filters: FinanceFilters) =>
  getPage<FinanceRebate>('/api/finance/rebates', filters)

export const getFinancialOperations = (filters: FinanceFilters) =>
  getPage<FinancialOperation>('/api/finance/operations', filters)

export async function createManualCredit(input: ManualCreditInput) {
  const { paymentChannel, ...credit } = input
  const response = await api.post<
    ApiResponse<{ operation: FinancialOperation; already_applied: boolean }>
  >('/api/finance/credits', { ...credit, payment_channel: paymentChannel })
  const data = requireServerSuccess(response.data).data
  if (!data?.operation) {
    throw createServerError({ message_key: 'Invalid response' })
  }
  return data
}

export async function completeFinanceTopup(tradeNo: string) {
  const response = await api.post('/api/user/topup/complete', {
    trade_no: tradeNo,
  })
  return requireServerSuccess(response.data)
}

export async function refundFinanceTopup(tradeNo: string, reason: string) {
  const response = await api.post('/api/finance/topups/refund', {
    trade_no: tradeNo,
    reason,
    external_refund_completed: true,
  })
  return requireServerSuccess(response.data)
}

export async function refundFinanceRedemption(
  redemptionId: number,
  reason: string
) {
  const response = await api.post('/api/finance/redemptions/refund', {
    redemption_id: redemptionId,
    reason,
    external_refund_completed: true,
  })
  return requireServerSuccess(response.data)
}

export async function reverseFinanceRebate(rebateId: number, reason: string) {
  const response = await api.post('/api/finance/rebates/reverse', {
    rebate_id: rebateId,
    reason,
  })
  return requireServerSuccess(response.data)
}

export async function applyFinancePenalty(
  userId: number,
  quota: number,
  reason: string,
  requestId: string,
  requestBased = false
) {
  const response = await api.post('/api/finance/penalties', {
    user_id: userId,
    quota,
    reason,
    request_id: requestId,
    request_based: requestBased,
  })
  return requireServerSuccess(response.data)
}

export async function getRequestBillings(requestId: string) {
  const response = await api.get<ApiResponse<RequestBilling[]>>(
    '/api/finance/requests',
    {
      params: { request_id: requestId },
    }
  )
  return requireServerSuccess(response.data).data || []
}

export async function getUserRequestBillings(
  userId: number,
  page: number,
  pageSize: number
) {
  const response = await api.get<ApiResponse<PageData<RequestBilling>>>(
    '/api/finance/requests/by-user',
    { params: { user_id: userId, p: page, page_size: pageSize } }
  )
  return (
    requireServerSuccess(response.data).data || {
      items: [],
      total: 0,
      page,
      page_size: pageSize,
    }
  )
}

export async function refundRequestBilling(billingId: string, reason: string) {
  const response = await api.post<
    ApiResponse<{ operation: FinancialOperation; already_refunded: boolean }>
  >('/api/finance/requests/refund', { billing_id: billingId, reason })
  return requireServerSuccess(response.data).data
}

export async function getRefundQueue(
  filters: RefundQueueFilters,
  page: number,
  pageSize: number
) {
  const response = await api.get<ApiResponse<PageData<RequestBilling>>>(
    '/api/finance/requests/queue',
    { params: { ...filters, p: page, page_size: pageSize } }
  )
  return requireServerSuccess(response.data).data || { items: [], total: 0 }
}

export async function createRefundBatch(
  billingIds: string[],
  reason: string,
  clientId: string
) {
  const response = await api.post<ApiResponse<RefundBatch>>(
    '/api/finance/refund-batches',
    { billing_ids: billingIds, reason, client_id: clientId }
  )
  const data = requireServerSuccess(response.data).data
  if (!data) throw new Error('Invalid refund batch response')
  return data
}

export async function getRefundBatches(page: number) {
  const response = await api.get<ApiResponse<PageData<RefundBatch>>>(
    '/api/finance/refund-batches',
    { params: { p: page, page_size: 10 } }
  )
  return requireServerSuccess(response.data).data || { items: [], total: 0 }
}

export async function retryRefundBatch(taskId: string, clientId: string) {
  const response = await api.post<ApiResponse<RefundBatch>>(
    `/api/finance/refund-batches/${encodeURIComponent(taskId)}/retry`,
    { client_id: clientId }
  )
  const data = requireServerSuccess(response.data).data
  if (!data) throw new Error('Invalid refund batch response')
  return data
}

export async function reverseFinancePenalty(penaltyId: number, reason: string) {
  const response = await api.post('/api/finance/penalties/reverse', {
    penalty_id: penaltyId,
    reason,
  })
  return requireServerSuccess(response.data)
}
