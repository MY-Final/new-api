import { api } from '@/lib/api'

import type {
  FinanceFilters,
  FinanceRebate,
  FinanceRedemption,
  FinanceTopup,
  FinancialOperation,
  PageData,
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
  if (!response.data.success) {
    throw new Error(response.data.message || 'Request failed')
  }
  return response.data.data || { items: [], total: 0 }
}

export const getFinanceTopups = (filters: FinanceFilters) =>
  getPage<FinanceTopup>('/api/finance/topups', filters)

export const getFinanceRedemptions = (filters: FinanceFilters) =>
  getPage<FinanceRedemption>('/api/finance/redemptions', filters)

export const getFinanceRebates = (filters: FinanceFilters) =>
  getPage<FinanceRebate>('/api/finance/rebates', filters)

export const getFinancialOperations = (filters: FinanceFilters) =>
  getPage<FinancialOperation>('/api/finance/operations', filters)

export async function completeFinanceTopup(tradeNo: string) {
  return (await api.post('/api/user/topup/complete', { trade_no: tradeNo })).data
}

export async function refundFinanceTopup(tradeNo: string, reason: string) {
  return (
    await api.post('/api/finance/topups/refund', {
      trade_no: tradeNo,
      reason,
      external_refund_completed: true,
    })
  ).data
}

export async function refundFinanceRedemption(
  redemptionId: number,
  reason: string
) {
  return (
    await api.post('/api/finance/redemptions/refund', {
      redemption_id: redemptionId,
      reason,
      external_refund_completed: true,
    })
  ).data
}

export async function reverseFinanceRebate(rebateId: number, reason: string) {
  return (
    await api.post('/api/finance/rebates/reverse', {
      rebate_id: rebateId,
      reason,
    })
  ).data
}

export async function applyFinancePenalty(
  userId: number,
  quota: number,
  reason: string,
  requestId: string
) {
  return (
    await api.post('/api/finance/penalties', {
      user_id: userId,
      quota,
      reason,
      request_id: requestId,
    })
  ).data
}

export async function reverseFinancePenalty(penaltyId: number, reason: string) {
  return (
    await api.post('/api/finance/penalties/reverse', {
      penalty_id: penaltyId,
      reason,
    })
  ).data
}
