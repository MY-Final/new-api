import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BadgeCell, TruncatedCell } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import type { AffiliateRebate } from '@/features/wallet/types'
import { formatQuotaPrecise, formatTimestampToDate } from '@/lib/format'

import { getSourceLabel, getStatusLabel } from '../lib/labels'

export function useAffiliateRebateColumns(): ColumnDef<AffiliateRebate>[] {
  const { t } = useTranslation()

  return useMemo(
    (): ColumnDef<AffiliateRebate>[] => [
      {
        accessorKey: 'source_type',
        header: t('Source'),
        meta: { mobileTitle: true },
        size: 150,
        cell: ({ row }) => {
          const rebate = row.original
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
        id: 'invitee',
        header: t('Invitee'),
        size: 150,
        cell: ({ row }) => {
          const rebate = row.original
          if (rebate.invitee_username) {
            return <span>{rebate.invitee_username}</span>
          }
          return <TableId value={rebate.invitee_id} />
        },
      },
      {
        accessorKey: 'rebate_quota',
        header: t('Rebate'),
        size: 120,
        cell: ({ row }) => (
          <span className='font-semibold text-emerald-600 dark:text-emerald-400'>
            +{formatQuotaPrecise(row.original.rebate_quota)}
          </span>
        ),
      },
      {
        accessorKey: 'base_quota',
        header: t('Base quota'),
        size: 110,
        cell: ({ row }) => (
          <span className='text-muted-foreground'>
            {formatQuotaPrecise(row.original.base_quota)}
          </span>
        ),
      },
      {
        id: 'rate',
        header: t('Rate'),
        size: 80,
        cell: ({ row }) => (
          <span className='text-muted-foreground'>
            {row.original.rate / 100}%
          </span>
        ),
      },
      {
        accessorKey: 'transferred_quota',
        header: t('Transferred'),
        size: 110,
        cell: ({ row }) => (
          <span className='text-muted-foreground'>
            {formatQuotaPrecise(row.original.transferred_quota)}
          </span>
        ),
      },
      {
        accessorKey: 'reversed_quota',
        header: t('Reversed'),
        size: 110,
        cell: ({ row }) => (
          <span className='text-muted-foreground'>
            {formatQuotaPrecise(row.original.reversed_quota)}
          </span>
        ),
      },
      {
        accessorKey: 'debt_offset_quota',
        header: t('Debt settled'),
        size: 110,
        cell: ({ row }) => {
          const rebate = row.original
          if (rebate.debt_offset_quota <= 0) {
            return <span className='text-muted-foreground'>-</span>
          }
          return (
            <span className='text-warning'>
              {formatQuotaPrecise(rebate.debt_offset_quota)}
            </span>
          )
        },
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        size: 110,
        cell: ({ row }) => (
          <BadgeCell>
            <StatusBadge
              label={getStatusLabel(row.original.status, t)}
              variant={
                row.original.status === 'reversed' ? 'danger' : 'success'
              }
              copyable={false}
            />
          </BadgeCell>
        ),
      },
      {
        accessorKey: 'created_at',
        header: t('Time'),
        size: 160,
        cell: ({ row }) => (
          <span className='text-muted-foreground text-xs'>
            {formatTimestampToDate(row.original.created_at)}
          </span>
        ),
      },
      {
        accessorKey: 'reverse_reason',
        header: t('Reason'),
        size: 200,
        cell: ({ row }) => {
          const reason = row.original.reverse_reason
          if (!reason) return <span className='text-muted-foreground'>-</span>
          return (
            <TruncatedCell
              cellClassName='max-w-[200px]'
              className='text-muted-foreground text-xs'
            >
              {reason}
            </TruncatedCell>
          )
        },
      },
    ],
    [t]
  )
}
