import type { TFunction } from 'i18next'

import type { StatusVariant } from '@/components/status-badge'

import type { FinanceSection } from '../types'

export const sectionNames: Record<FinanceSection, string> = {
  topups: 'Top-up Orders',
  redemptions: 'Redemption Codes',
  rebates: 'Rebate Ledger',
  operations: 'Financial Operations',
}

export function asSection(value: string): FinanceSection {
  if (
    value === 'redemptions' ||
    value === 'rebates' ||
    value === 'operations'
  ) {
    return value
  }
  return 'topups'
}

export function filterPlaceholder(section: FinanceSection, t: TFunction) {
  if (section === 'topups') return t('Order number')
  if (section === 'redemptions') return t('Code, name, or ID')
  return t('Source ID')
}

export function filterUserLabel(section: FinanceSection, t: TFunction) {
  return t(section === 'rebates' ? 'Inviter ID' : 'Operator ID')
}

export function getStatusLabel(status: string, t: TFunction) {
  const labels: Record<string, string> = {
    all: 'All statuses',
    success: 'Success',
    pending: 'Pending',
    used: 'Used',
    refunded: 'Refunded',
    '1': 'Unused',
    '2': 'Disabled',
    '3': 'Used',
    '4': 'Refunded',
    settled: 'Settled',
    reversed: 'Reversed',
    expired: 'Expired',
    failed: 'Failed',
  }
  return labels[status] ? t(labels[status]) : status
}

export function getProviderLabel(provider: string, t: TFunction) {
  if (provider === 'all') return t('All providers')
  if (provider === 'epay') return 'Epay'
  if (provider === 'stripe') return 'Stripe'
  if (provider === 'creem') return 'Creem'
  if (provider === 'waffo') return 'Waffo'
  return provider
}

export function getCodeTypeLabel(type: string, t: TFunction) {
  if (type === 'all') return t('All types')
  if (type === 'paid') return t('Paid code')
  if (type === 'reward') return t('Reward code')
  return type
}

export function getSourceLabel(source: string, t: TFunction) {
  if (source === 'all') return t('All sources')
  if (source === 'signup') return t('Registration')
  if (source === 'topup') return t('Top-up')
  if (source === 'redemption') return t('Redemption code')
  return source
}

export function getOperationTypeLabel(type: string, t: TFunction) {
  const labels: Record<string, string> = {
    topup_refund: 'Refund top-up',
    redemption_refund: 'Refund redemption',
    rebate_reversal: 'Reverse rebate',
    penalty: 'Apply penalty',
    penalty_reversal: 'Reverse penalty',
  }
  return labels[type] ? t(labels[type]) : type
}

export function getStatusOptions(
  section: FinanceSection,
  t: TFunction
): { value: string; label: string }[] {
  if (section === 'topups') {
    return [
      { value: 'all', label: t('All statuses') },
      { value: 'success', label: t('Success') },
      { value: 'pending', label: t('Pending') },
      { value: 'failed', label: t('Failed') },
      { value: 'refunded', label: t('Refunded') },
    ]
  }

  if (section === 'redemptions') {
    return [
      { value: 'all', label: t('All statuses') },
      { value: '1', label: t('Unused') },
      { value: '2', label: t('Disabled') },
      { value: '3', label: t('Used') },
      { value: '4', label: t('Refunded') },
    ]
  }

  return [
    { value: 'all', label: t('All statuses') },
    { value: 'settled', label: t('Settled') },
    { value: 'reversed', label: t('Reversed') },
  ]
}

export function getProviderOptions(t: TFunction) {
  return [
    { value: 'all', label: t('All providers') },
    { value: 'epay', label: 'Epay' },
    { value: 'stripe', label: 'Stripe' },
    { value: 'creem', label: 'Creem' },
    { value: 'waffo', label: 'Waffo' },
  ]
}

export function getCodeTypeOptions(t: TFunction) {
  return [
    { value: 'all', label: t('All types') },
    { value: 'paid', label: t('Paid code') },
    { value: 'reward', label: t('Reward code') },
  ]
}

export function getOperationTypeOptions(t: TFunction) {
  return [
    { value: 'all', label: t('All operation types') },
    { value: 'topup_refund', label: t('Refund top-up') },
    { value: 'redemption_refund', label: t('Refund redemption') },
    { value: 'rebate_reversal', label: t('Reverse rebate') },
    { value: 'penalty', label: t('Apply penalty') },
    { value: 'penalty_reversal', label: t('Reverse penalty') },
  ]
}

const topupStatusVariants: Record<string, StatusVariant> = {
  success: 'success',
  pending: 'warning',
  failed: 'danger',
  refunded: 'neutral',
}

const redemptionStatusVariants: Record<string, StatusVariant> = {
  '1': 'success',
  '2': 'neutral',
  '3': 'neutral',
  '4': 'danger',
}

const rebateStatusVariants: Record<string, StatusVariant> = {
  settled: 'success',
  reversed: 'danger',
}

export function getStatusVariant(
  section: FinanceSection,
  status: string
): StatusVariant {
  if (section === 'topups') return topupStatusVariants[status] ?? 'neutral'
  if (section === 'redemptions') {
    return redemptionStatusVariants[status] ?? 'neutral'
  }
  return rebateStatusVariants[status] ?? 'neutral'
}

const operationTypeVariants: Record<string, StatusVariant> = {
  topup_refund: 'info',
  redemption_refund: 'info',
  rebate_reversal: 'warning',
  penalty: 'danger',
  penalty_reversal: 'neutral',
}

export function getOperationTypeVariant(type: string): StatusVariant {
  return operationTypeVariants[type] ?? 'neutral'
}
