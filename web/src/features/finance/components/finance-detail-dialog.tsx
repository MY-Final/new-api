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
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { formatNumber, formatQuota, formatTimestamp } from '@/lib/format'

import {
  getCodeTypeLabel,
  getOperationTypeLabel,
  getProviderLabel,
  getSourceLabel,
  getStatusLabel,
} from '../lib/labels'
import type {
  FinanceRebate,
  FinanceRecord,
  FinanceRedemption,
  FinanceSection,
  FinanceTopup,
  FinancialOperation,
} from '../types'

type DetailRow = {
  label: string
  value: ReactNode
}

/** Money is shown in the configured currency with the raw quota units kept for audit. */
function money(quota: number | undefined | null): ReactNode {
  const value = quota ?? 0
  return (
    <span className='inline-flex items-baseline gap-2'>
      <span>{formatQuota(value)}</span>
      <span className='text-muted-foreground text-xs'>
        {formatNumber(value)}
      </span>
    </span>
  )
}

function signedMoney(delta: number | undefined | null): ReactNode {
  const value = delta ?? 0
  if (value === 0) return money(0)
  const prefix = value > 0 ? '+' : ''
  return (
    <span className='inline-flex items-baseline gap-2'>
      <span>
        {prefix}
        {formatQuota(value)}
      </span>
      <span className='text-muted-foreground text-xs'>
        {formatNumber(value)}
      </span>
    </span>
  )
}

/** Balance transition: before → after (delta). */
function transition(before: number, after: number): ReactNode {
  const delta = after - before
  return (
    <span className='inline-flex flex-wrap items-baseline gap-2'>
      <span>
        {formatNumber(before)} → {formatNumber(after)}
      </span>
      <span className={deltaClass(delta)}>{formatDelta(delta)}</span>
    </span>
  )
}

function formatDelta(delta: number): string {
  if (delta === 0) return '0'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${formatNumber(delta)}`
}

function deltaClass(delta: number): string {
  if (delta === 0) return 'text-muted-foreground text-xs'
  if (delta > 0) return 'text-xs text-emerald-600 dark:text-emerald-400'
  return 'text-xs text-red-600 dark:text-red-400'
}

function operationRows(item: FinancialOperation, t: TFunction) {
  const rows: DetailRow[] = [
    {
      label: t('Operation type'),
      value: getOperationTypeLabel(item.operation_type, t),
    },
    { label: t('Operator'), value: item.operator_username || item.operator_id },
    { label: t('Target'), value: item.target_username || item.target_user_id },
  ]
  if (item.related_user_id > 0) {
    rows.push({
      label: t('Related user'),
      value: item.related_username || item.related_user_id,
    })
  }
  rows.push(
    { label: t('Amount'), value: money(item.principal_quota) },
    { label: t('Target balance'), value: transition(item.target_main_before, item.target_main_after) }
  )
  if (item.target_bonus_delta !== 0 || item.target_paid_delta !== 0) {
    rows.push(
      { label: t('Bonus quota'), value: signedMoney(item.target_bonus_delta) },
      { label: t('Paid quota'), value: signedMoney(item.target_paid_delta) }
    )
  }
  if (item.related_user_id > 0) {
    rows.push(
      { label: t('Rebate'), value: money(item.rebate_quota) },
      {
        label: t('Main balance'),
        value: transition(item.related_main_before, item.related_main_after),
      },
      {
        label: t('Affiliate quota'),
        value: transition(
          item.related_affiliate_before,
          item.related_affiliate_after
        ),
      }
    )
  }
  rows.push(
    { label: t('Source'), value: item.source_id || item.source_type },
    { label: t('Reason'), value: item.reason },
    { label: t('Time'), value: formatTimestamp(item.created_at) },
    { label: t('Operation key'), value: item.operation_key }
  )
  if (item.reversal_of_id > 0) {
    rows.push({ label: t('Reversal of'), value: `#${item.reversal_of_id}` })
  }
  if (item.reversed_by_id) {
    rows.push({ label: t('Reversed by'), value: `#${item.reversed_by_id}` })
  }
  return rows
}

function topupRows(item: FinanceTopup, t: TFunction) {
  const rows: DetailRow[] = [
    { label: t('Order number'), value: item.trade_no },
    { label: t('User'), value: item.username || item.user_id },
    { label: t('Amount'), value: money(item.credited_quota) },
    {
      label: t('Provider'),
      value: getProviderLabel(item.payment_provider ?? '', t),
    },
    { label: t('Status'), value: getStatusLabel(item.status, t) },
    { label: t('Time'), value: formatTimestamp(item.create_time) },
  ]
  if (item.rebate_quota) {
    rows.push(
      { label: t('Rebate'), value: money(item.rebate_quota) },
      { label: t('Inviter'), value: item.inviter_username ?? item.inviter_id ?? '' }
    )
  }
  if (item.refunded_at) {
    rows.push(
      { label: t('Refunded at'), value: formatTimestamp(item.refunded_at) },
      { label: t('Refund reason'), value: item.refund_reason ?? '' },
      { label: t('Refunded by'), value: item.refunded_by ?? '' }
    )
  }
  return rows
}

function redemptionRows(item: FinanceRedemption, t: TFunction) {
  const rows: DetailRow[] = [
    { label: t('ID'), value: item.id },
    { label: t('Redemption code'), value: item.key },
    { label: t('Type'), value: getCodeTypeLabel(item.type, t) },
    { label: t('Amount'), value: money(item.quota) },
    { label: t('Status'), value: getStatusLabel(String(item.status), t) },
    { label: t('Time'), value: formatTimestamp(item.created_time) },
  ]
  if (item.used_username || item.used_user_id) {
    rows.push(
      { label: t('Used by'), value: item.used_username || item.used_user_id },
      {
        label: t('Redeemed at'),
        value: item.redeemed_time ? formatTimestamp(item.redeemed_time) : '',
      }
    )
  }
  if (item.used_user_quota !== undefined) {
    rows.push({ label: t('Used quota'), value: money(item.used_user_quota) })
  }
  if (item.refunded_at) {
    rows.push(
      { label: t('Refunded at'), value: formatTimestamp(item.refunded_at) },
      { label: t('Refund reason'), value: item.refund_reason ?? '' },
      { label: t('Refunded by'), value: item.refunded_by ?? '' }
    )
  }
  return rows
}

function rebateRows(item: FinanceRebate, t: TFunction) {
  const rows: DetailRow[] = [
    { label: t('ID'), value: item.id },
    { label: t('Inviter'), value: item.inviter_username || item.inviter_id },
    { label: t('Invitee'), value: item.invitee_username || item.invitee_id },
    { label: t('Source'), value: getSourceLabel(item.source_type, t) },
    { label: t('Base quota'), value: money(item.base_quota) },
    { label: t('Rate'), value: `${item.rate / 100}%` },
    { label: t('Rebate'), value: money(item.rebate_quota) },
    { label: t('Reversed'), value: money(item.reversed_quota) },
    { label: t('Transferred'), value: money(item.transferred_quota) },
    { label: t('Status'), value: getStatusLabel(item.status, t) },
    { label: t('Time'), value: formatTimestamp(item.created_at) },
  ]
  if (item.debt_offset_quota) {
    rows.push({
      label: t('Debt offset'),
      value: money(item.debt_offset_quota),
    })
  }
  if (item.reversed_at) {
    rows.push(
      { label: t('Reversed at'), value: formatTimestamp(item.reversed_at) },
      { label: t('Reason'), value: item.reverse_reason ?? '' }
    )
  }
  return rows
}

export function FinanceDetailDialog(props: {
  section: FinanceSection
  item: FinanceRecord | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const item = props.item
  if (!item) return null

  let rows: DetailRow[] = []
  if (props.section === 'topups') {
    rows = topupRows(item as FinanceTopup, t)
  } else if (props.section === 'redemptions') {
    rows = redemptionRows(item as FinanceRedemption, t)
  } else if (props.section === 'rebates') {
    rows = rebateRows(item as FinanceRebate, t)
  } else {
    rows = operationRows(item as FinancialOperation, t)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Details')}
      contentClassName='sm:max-w-2xl'
    >
      <dl className='grid gap-x-6 gap-y-2 sm:grid-cols-2'>
        {rows.map((row) => (
          <div key={row.label} className='min-w-0 space-y-0.5'>
            <dt className='text-muted-foreground text-xs'>{row.label}</dt>
            <dd className='truncate text-sm tabular-nums'>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
