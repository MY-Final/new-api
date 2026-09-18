import type { ColumnDef } from '@tanstack/react-table'
import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { BadgeCell, TruncatedCell } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import {
  formatQuota,
  formatQuotaPrecise,
  formatTimestampToDate,
} from '@/lib/format'

import {
  getCodeTypeLabel,
  getOperationTypeLabel,
  getOperationTypeVariant,
  getProviderLabel,
  getSourceLabel,
  getStatusLabel,
  getStatusVariant,
} from '../lib/labels'
import type {
  FinanceAction,
  FinanceRebate,
  FinanceRecord,
  FinanceRedemption,
  FinanceSection,
  FinanceTopup,
  FinancialOperation,
} from '../types'
import { FinanceRowActions } from './finance-row-actions'

type ColumnContext = {
  t: TFunction
  onAction: (action: FinanceAction) => void
  onRefresh: () => void
}

function getActionsColumn(
  ctx: ColumnContext,
  section: FinanceSection
): ColumnDef<FinanceRecord> {
  return {
    id: 'actions',
    header: ctx.t('Actions'),
    meta: { pinned: 'right' },
    enableSorting: false,
    enableHiding: false,
    size: 60,
    cell: ({ row }) => (
      <FinanceRowActions
        section={section}
        row={row}
        onAction={ctx.onAction}
        onRefresh={ctx.onRefresh}
      />
    ),
  }
}

function getTopupColumns(ctx: ColumnContext): ColumnDef<FinanceRecord>[] {
  const { t } = ctx
  return [
    {
      accessorKey: 'trade_no',
      header: t('Order number'),
      meta: { mobileTitle: true },
      size: 240,
      cell: ({ row }) => {
        const topup = row.original as FinanceTopup
        return (
          <div className='flex min-w-0 items-center gap-1'>
            <TruncatedCell
              cellClassName='max-w-[200px]'
              className='font-mono text-xs'
            >
              {topup.trade_no}
            </TruncatedCell>
            <CopyButton value={topup.trade_no} size='icon' className='size-7' />
          </div>
        )
      },
    },
    {
      id: 'user',
      header: t('User'),
      size: 140,
      cell: ({ row }) => {
        const topup = row.original as FinanceTopup
        if (topup.username) return <span>{topup.username}</span>
        return <TableId value={topup.user_id} />
      },
    },
    {
      id: 'amount',
      header: t('Amount'),
      size: 120,
      cell: ({ row }) => {
        const topup = row.original as FinanceTopup
        return (
          <span className='font-semibold'>
            {formatQuota(topup.credited_quota || topup.amount)}
          </span>
        )
      },
    },
    {
      id: 'rebate',
      header: t('Rebate'),
      size: 110,
      cell: ({ row }) => {
        const topup = row.original as FinanceTopup
        return (
          <span className='text-muted-foreground'>
            {formatQuotaPrecise(topup.rebate_quota || 0)}
          </span>
        )
      },
    },
    {
      id: 'provider',
      header: t('Provider'),
      size: 110,
      cell: ({ row }) => {
        const topup = row.original as FinanceTopup
        return (
          <BadgeCell>
            <StatusBadge
              label={getProviderLabel(
                topup.payment_provider || topup.payment_method,
                t
              )}
              variant='neutral'
              copyable={false}
            />
          </BadgeCell>
        )
      },
    },
    {
      id: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      size: 110,
      cell: ({ row }) => {
        const topup = row.original as FinanceTopup
        return (
          <BadgeCell>
            <StatusBadge
              label={getStatusLabel(topup.status, t)}
              variant={getStatusVariant('topups', topup.status)}
              copyable={false}
            />
          </BadgeCell>
        )
      },
    },
    {
      accessorKey: 'create_time',
      header: t('Time'),
      size: 160,
      cell: ({ row }) => {
        const topup = row.original as FinanceTopup
        return (
          <span className='text-muted-foreground text-xs'>
            {formatTimestampToDate(topup.create_time)}
          </span>
        )
      },
    },
    getActionsColumn(ctx, 'topups'),
  ]
}

function getRedemptionColumns(ctx: ColumnContext): ColumnDef<FinanceRecord>[] {
  const { t } = ctx
  return [
    {
      accessorKey: 'name',
      header: t('Name'),
      meta: { mobileTitle: true },
      size: 180,
      cell: ({ row }) => {
        const redemption = row.original as FinanceRedemption
        return <span className='font-medium'>{redemption.name}</span>
      },
    },
    {
      accessorKey: 'id',
      header: t('ID'),
      meta: { mobileHidden: true },
      size: 80,
      cell: ({ row }) => {
        const redemption = row.original as FinanceRedemption
        return <TableId value={redemption.id} />
      },
    },
    {
      accessorKey: 'key',
      header: t('Redemption code'),
      meta: { mobileHidden: true },
      size: 240,
      cell: ({ row }) => {
        const redemption = row.original as FinanceRedemption
        return (
          <div className='flex min-w-0 items-center gap-1'>
            <TruncatedCell
              cellClassName='max-w-[200px]'
              className='font-mono text-xs'
            >
              {redemption.key}
            </TruncatedCell>
            <CopyButton value={redemption.key} size='icon' className='size-7' />
          </div>
        )
      },
    },
    {
      accessorKey: 'type',
      header: t('Type'),
      size: 110,
      cell: ({ row }) => {
        const redemption = row.original as FinanceRedemption
        return (
          <BadgeCell>
            <StatusBadge
              label={getCodeTypeLabel(redemption.type, t)}
              variant={redemption.type === 'paid' ? 'success' : 'neutral'}
              copyable={false}
            />
          </BadgeCell>
        )
      },
    },
    {
      accessorKey: 'quota',
      header: t('Amount'),
      size: 110,
      cell: ({ row }) => {
        const redemption = row.original as FinanceRedemption
        return (
          <span className='font-semibold'>{formatQuota(redemption.quota)}</span>
        )
      },
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      size: 110,
      cell: ({ row }) => {
        const redemption = row.original as FinanceRedemption
        return (
          <BadgeCell>
            <StatusBadge
              label={getStatusLabel(String(redemption.status), t)}
              variant={getStatusVariant(
                'redemptions',
                String(redemption.status)
              )}
              copyable={false}
            />
          </BadgeCell>
        )
      },
    },
    {
      id: 'used_by',
      header: t('Used by'),
      size: 140,
      cell: ({ row }) => {
        const redemption = row.original as FinanceRedemption
        if (redemption.used_username) {
          return <span>{redemption.used_username}</span>
        }
        return (
          <span className='text-muted-foreground'>{t('Not redeemed')}</span>
        )
      },
    },
    {
      accessorKey: 'redeemed_time',
      header: t('Redeemed at'),
      size: 160,
      cell: ({ row }) => {
        const redemption = row.original as FinanceRedemption
        if (!redemption.redeemed_time) {
          return <span className='text-muted-foreground'>-</span>
        }
        return (
          <span className='text-muted-foreground text-xs'>
            {formatTimestampToDate(redemption.redeemed_time)}
          </span>
        )
      },
    },
    getActionsColumn(ctx, 'redemptions'),
  ]
}

function getRebateColumns(ctx: ColumnContext): ColumnDef<FinanceRecord>[] {
  const { t } = ctx
  return [
    {
      id: 'inviter',
      header: t('Inviter'),
      meta: { mobileTitle: true },
      size: 140,
      cell: ({ row }) => {
        const rebate = row.original as FinanceRebate
        if (rebate.inviter_username) {
          return <span>{rebate.inviter_username}</span>
        }
        return <TableId value={rebate.inviter_id} />
      },
    },
    {
      id: 'invitee',
      header: t('Invitee'),
      size: 140,
      cell: ({ row }) => {
        const rebate = row.original as FinanceRebate
        if (rebate.invitee_username) {
          return <span>{rebate.invitee_username}</span>
        }
        return <TableId value={rebate.invitee_id} />
      },
    },
    {
      id: 'source',
      header: t('Source'),
      size: 150,
      cell: ({ row }) => {
        const rebate = row.original as FinanceRebate
        return (
          <div className='min-w-0'>
            <div>{getSourceLabel(rebate.source_type, t)}</div>
            <div className='text-muted-foreground text-xs'>
              {rebate.source_id}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'base_quota',
      header: t('Base quota'),
      size: 110,
      cell: ({ row }) => {
        const rebate = row.original as FinanceRebate
        return (
          <span className='text-muted-foreground'>
            {formatQuotaPrecise(rebate.base_quota)}
          </span>
        )
      },
    },
    {
      id: 'rate',
      header: t('Rate'),
      size: 80,
      cell: ({ row }) => {
        const rebate = row.original as FinanceRebate
        return (
          <span className='text-muted-foreground'>{rebate.rate / 100}%</span>
        )
      },
    },
    {
      accessorKey: 'rebate_quota',
      header: t('Rebate'),
      size: 110,
      cell: ({ row }) => {
        const rebate = row.original as FinanceRebate
        return (
          <div className='min-w-0'>
            <span className='font-semibold'>
              {formatQuotaPrecise(rebate.rebate_quota)}
            </span>
            {rebate.debt_offset_quota > 0 ? (
              <div className='text-warning text-xs'>
                {t('Debt settled')}:{' '}
                {formatQuotaPrecise(rebate.debt_offset_quota)}
              </div>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      size: 110,
      cell: ({ row }) => {
        const rebate = row.original as FinanceRebate
        return (
          <BadgeCell>
            <StatusBadge
              label={getStatusLabel(rebate.status, t)}
              variant={getStatusVariant('rebates', rebate.status)}
              copyable={false}
            />
          </BadgeCell>
        )
      },
    },
    {
      accessorKey: 'created_at',
      header: t('Time'),
      size: 160,
      cell: ({ row }) => {
        const rebate = row.original as FinanceRebate
        return (
          <span className='text-muted-foreground text-xs'>
            {formatTimestampToDate(rebate.created_at)}
          </span>
        )
      },
    },
    getActionsColumn(ctx, 'rebates'),
  ]
}

function getOperationColumns(ctx: ColumnContext): ColumnDef<FinanceRecord>[] {
  const { t } = ctx
  return [
    {
      accessorKey: 'operation_type',
      header: t('Operation type'),
      meta: { mobileTitle: true },
      size: 160,
      cell: ({ row }) => {
        const operation = row.original as FinancialOperation
        return (
          <BadgeCell>
            <StatusBadge
              label={getOperationTypeLabel(operation.operation_type, t)}
              variant={getOperationTypeVariant(operation.operation_type)}
              copyable={false}
            />
          </BadgeCell>
        )
      },
    },
    {
      id: 'operator',
      header: t('Operator'),
      size: 140,
      cell: ({ row }) => {
        const operation = row.original as FinancialOperation
        if (operation.operator_username) {
          return <span>{operation.operator_username}</span>
        }
        return <TableId value={operation.operator_id} />
      },
    },
    {
      id: 'target',
      header: t('Target'),
      size: 160,
      cell: ({ row }) => {
        const operation = row.original as FinancialOperation
        return (
          <div className='min-w-0'>
            <div>{operation.target_username || '-'}</div>
            <div className='text-muted-foreground text-xs'>
              {t('User ID')}: {operation.target_user_id}
            </div>
          </div>
        )
      },
    },
    {
      id: 'amount',
      header: t('Amount'),
      size: 110,
      cell: ({ row }) => {
        const operation = row.original as FinancialOperation
        return (
          <span className='font-semibold'>
            {formatQuota(operation.principal_quota || operation.rebate_quota)}
          </span>
        )
      },
    },
    {
      accessorKey: 'reason',
      header: t('Reason'),
      size: 220,
      cell: ({ row }) => {
        const operation = row.original as FinancialOperation
        if (!operation.reason) return null
        return (
          <TruncatedCell
            cellClassName='max-w-[220px]'
            className='text-muted-foreground text-xs'
          >
            {operation.reason}
          </TruncatedCell>
        )
      },
    },
    {
      accessorKey: 'created_at',
      header: t('Time'),
      size: 160,
      cell: ({ row }) => {
        const operation = row.original as FinancialOperation
        return (
          <span className='text-muted-foreground text-xs'>
            {formatTimestampToDate(operation.created_at)}
          </span>
        )
      },
    },
    getActionsColumn(ctx, 'operations'),
  ]
}

export function useFinanceColumns(
  section: FinanceSection,
  onAction: (action: FinanceAction) => void,
  onRefresh: () => void
): ColumnDef<FinanceRecord>[] {
  const { t } = useTranslation()
  return useMemo(() => {
    const ctx: ColumnContext = { t, onAction, onRefresh }
    if (section === 'redemptions') return getRedemptionColumns(ctx)
    if (section === 'rebates') return getRebateColumns(ctx)
    if (section === 'operations') return getOperationColumns(ctx)
    return getTopupColumns(ctx)
  }, [section, t, onAction, onRefresh])
}
