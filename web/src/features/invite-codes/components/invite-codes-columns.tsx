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
import type { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatTimestampToDate } from '@/lib/format'

import type { InviteCode } from '../types'
import { InviteCodeRegistrationsCell } from './invite-code-registrations-cell'
import {
  InviteCodeRowActions,
  type InviteCodeActions,
} from './invite-code-row-actions'

function isExpired(code: InviteCode): boolean {
  return code.expires_at > 0 && code.expires_at <= Date.now() / 1000
}

export function useInviteCodesColumns(
  actions: InviteCodeActions
): ColumnDef<InviteCode>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return [
    {
      accessorKey: 'id',
      header: t('ID'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <TableId value={row.original.id} className='w-[60px]' />
      ),
      size: 80,
    },
    {
      accessorKey: 'name',
      header: t('Campaign'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='min-w-[160px]'>
          <div className='font-medium'>{row.original.name}</div>
          {row.original.remark && (
            <div className='text-muted-foreground max-w-[240px] truncate text-xs'>
              {row.original.remark}
            </div>
          )}
        </div>
      ),
      size: 220,
    },
    {
      accessorKey: 'code',
      header: t('Invitation code'),
      cell: ({ row }) => (
        <div className='flex min-w-[190px] items-center gap-1'>
          <span className='font-mono text-sm'>{row.original.code}</span>
          <CopyButton
            value={row.original.code}
            size='icon'
            className='size-7'
            iconClassName='size-3.5'
            tooltip={t('Copy invitation code')}
          />
        </div>
      ),
      enableSorting: false,
      size: 240,
    },
    {
      id: 'status',
      accessorFn: (row) => (row.enabled ? 'enabled' : 'disabled'),
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const code = row.original
        if (!code.enabled) {
          return (
            <StatusBadge
              label={t('Disabled')}
              variant='neutral'
              copyable={false}
              className='-ml-1.5'
            />
          )
        }
        if (isExpired(code)) {
          return (
            <StatusBadge
              label={t('Expired')}
              variant='warning'
              copyable={false}
              className='-ml-1.5'
            />
          )
        }
        if (
          code.registration_limit > 0 &&
          code.registered_count >= code.registration_limit
        ) {
          return (
            <StatusBadge
              label={t('Full')}
              variant='warning'
              copyable={false}
              className='-ml-1.5'
            />
          )
        }
        return (
          <StatusBadge
            label={t('Enabled')}
            variant='success'
            copyable={false}
            className='-ml-1.5'
          />
        )
      },
      size: 110,
    },
    {
      accessorKey: 'group',
      header: t('Group'),
      cell: ({ row }) => (
        <StatusBadge
          label={row.original.group}
          variant='info'
          copyable={false}
          className='-ml-1.5'
        />
      ),
      size: 130,
    },
    {
      id: 'registrations',
      header: t('Registrations'),
      cell: ({ row }) => (
        <InviteCodeRegistrationsCell
          code={row.original}
          locale={locale}
          onOpen={() => actions.onClaims(row.original)}
        />
      ),
      size: 170,
    },
    {
      accessorKey: 'bonus_quota',
      header: t('Registration bonus'),
      cell: ({ row }) => (
        <span className='font-medium'>
          {formatQuotaWithCurrency(row.original.bonus_quota, {
            abbreviate: false,
          })}
        </span>
      ),
      size: 150,
    },
    {
      accessorKey: 'inviter_id',
      header: t('Inviter'),
      meta: { mobileHidden: true },
      cell: ({ row }) =>
        row.original.inviter_id > 0 ? (
          <TableId value={row.original.inviter_id} />
        ) : (
          <span className='text-muted-foreground'>-</span>
        ),
      size: 100,
    },
    {
      accessorKey: 'expires_at',
      header: t('Expires'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const code = row.original
        if (code.expires_at === 0) {
          return (
            <StatusBadge
              label={t('Never')}
              variant='neutral'
              copyable={false}
              className='-ml-1.5'
            />
          )
        }
        return (
          <span
            className={
              isExpired(code)
                ? 'text-destructive min-w-[150px] font-mono text-sm'
                : 'min-w-[150px] font-mono text-sm'
            }
          >
            {formatTimestampToDate(code.expires_at)}
          </span>
        )
      },
      size: 170,
    },
    {
      id: 'actions',
      header: () => t('Actions'),
      cell: ({ row }) => <InviteCodeRowActions row={row} actions={actions} />,
      meta: { pinned: 'right' as const },
    },
  ]
}
