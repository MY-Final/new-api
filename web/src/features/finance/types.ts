import type { AffiliateRebate, TopupRecord } from '@/features/wallet/types'

export interface FinanceTopup extends TopupRecord {
  payment_provider?: string
  username?: string
  user_quota?: number
  refunded_by?: number
  rebate_quota?: number
  rebate_reversed_quota?: number
  rebate_transferred_quota?: number
  inviter_id?: number
  inviter_username?: string
  inviter_quota?: number
  inviter_aff_quota?: number
}

export interface FinanceRedemption {
  id: number
  user_id: number
  key: string
  status: number
  name: string
  quota: number
  created_time: number
  redeemed_time: number
  used_user_id: number
  expired_time: number
  type: 'paid' | 'reward'
  refunded_at: number
  refund_reason?: string
  refunded_by: number
  used_username?: string
  used_user_quota?: number
  rebate_quota?: number
  rebate_reversed_quota?: number
  rebate_transferred_quota?: number
  inviter_id?: number
  inviter_username?: string
  inviter_quota?: number
  inviter_aff_quota?: number
}

export interface FinanceRebate extends AffiliateRebate {
  inviter_quota?: number
  inviter_aff_quota?: number
  invitee_quota?: number
  reversed_by?: number
}

export type FinanceOperationType =
  | 'topup_refund'
  | 'redemption_refund'
  | 'rebate_reversal'
  | 'penalty'
  | 'penalty_reversal'

export interface FinancialOperation {
  id: number
  operation_type: FinanceOperationType
  operation_key: string
  reversal_of_id: number
  operator_id: number
  operator_username: string
  target_user_id: number
  target_username: string
  related_user_id: number
  related_username: string
  source_type: string
  source_id: string
  principal_quota: number
  rebate_quota: number
  target_main_delta: number
  related_main_delta: number
  related_affiliate_delta: number
  target_main_before: number
  target_main_after: number
  related_main_before: number
  related_main_after: number
  related_affiliate_before: number
  related_affiliate_after: number
  reason: string
  created_at: number
}

export interface FinanceFilters {
  page: number
  pageSize: number
  keyword?: string
  userId?: number
  inviterId?: number
  inviteeId?: number
  operatorId?: number
  sourceType?: string
  status?: string
  provider?: string
  operationType?: string
  startTime?: number
  endTime?: number
}

export interface PageData<T> {
  items: T[]
  total: number
}
