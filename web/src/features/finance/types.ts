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
  | 'request_refund'
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
  target_bonus_delta: number
  target_paid_delta: number
  related_main_before: number
  related_main_after: number
  related_affiliate_before: number
  related_affiliate_after: number
  /** Reversal operation that undid this row; 0 when it was never reversed. */
  reversed_by_id?: number
  reason: string
  created_at: number
}

export type FinanceSection = 'topups' | 'redemptions' | 'rebates' | 'operations'

export type FinanceRecord =
  | FinanceTopup
  | FinanceRedemption
  | FinanceRebate
  | FinancialOperation

export type PenaltyMode = 'request' | 'custom'

export type FinanceAction =
  | { kind: 'topup-refund'; item: FinanceTopup }
  | { kind: 'redemption-refund'; item: FinanceRedemption }
  | { kind: 'rebate-reverse'; item: FinanceRebate }
  | { kind: 'penalty'; item?: undefined }
  | { kind: 'penalty-reverse'; item: FinancialOperation }

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

export interface RequestBilling {
  billing_id: string
  request_id: string
  user_id: number
  username: string
  model_name: string
  channel_id?: number
  funding_source: 'wallet' | 'subscription'
  subscription_id: number
  task_id?: string
  quota: number
  bonus_quota: number
  paid_quota: number
  refunded_quota: number
  refunded_at: number
  refund_operation_id: number
  created_at: number
  settled: boolean
  blocked_reason?: string
}

export interface RefundQueueFilters {
  user_id?: number
  request_id?: string
  model_name?: string
  channel_id?: number
  funding_source?: 'wallet' | 'subscription'
  status?: 'unrefunded' | 'refunded'
  start_time?: number
  end_time?: number
}

export interface RefundBatchItem {
  billing_id: string
  request_id: string
  username: string
  quota: number
  status: 'pending' | 'succeeded' | 'failed'
  error?: string
  operation_id?: number
  already_refunded: boolean
}

export interface RefundBatchState {
  items: RefundBatchItem[]
  total: number
  processed: number
  succeeded: number
  failed: number
  progress: number
}

export interface RefundBatch {
  task_id: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  payload: { billing_ids: string[]; reason: string; operator_id: number }
  state: RefundBatchState
  created_at: number
  error?: string
}
