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
import { Eye, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TruncatedCell } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import dayjs from '@/lib/dayjs'

import type { RequestErrorLog } from '../api'

type ErrorRequestColumnActions = {
  onView: (entry: RequestErrorLog) => void
  onDelete: (entry: RequestErrorLog) => void
}

export function useErrorRequestColumns(
  actions: ErrorRequestColumnActions
): ColumnDef<RequestErrorLog>[] {
  const { t } = useTranslation()
  const { onView, onDelete } = actions
  return useMemo(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        size: 170,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {dayjs.unix(row.original.created_at).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        ),
        meta: { label: t('Time'), mobileTitle: true },
      },
      {
        id: 'user',
        header: t('User'),
        size: 140,
        accessorFn: (entry) =>
          entry.username
            ? `${entry.username} (#${entry.user_id})`
            : `#${entry.user_id}`,
        cell: ({ getValue }) => (
          <TruncatedCell className='max-w-40'>
            {getValue<string>()}
          </TruncatedCell>
        ),
        meta: { label: t('User') },
      },
      {
        accessorKey: 'model_name',
        header: t('Model'),
        size: 170,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-44'>
            {row.original.model_name || '—'}
          </TruncatedCell>
        ),
        meta: { label: t('Model') },
      },
      {
        accessorKey: 'channel_id',
        header: t('Channel'),
        size: 90,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {row.original.channel_id || '—'}
          </span>
        ),
        meta: { label: t('Channel') },
      },
      {
        accessorKey: 'status_code',
        header: t('Status'),
        size: 80,
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status_code >= 500 ? 'destructive' : 'secondary'
            }
            className='font-mono'
          >
            {row.original.status_code}
          </Badge>
        ),
        meta: { label: t('Status') },
      },
      {
        accessorKey: 'error_message',
        header: t('Error'),
        size: 360,
        cell: ({ row }) => (
          <TruncatedCell
            className='max-w-96'
            contentClassName='line-clamp-2 whitespace-normal break-words'
            tooltipContent={row.original.error_message}
          >
            {row.original.error_message || '—'}
          </TruncatedCell>
        ),
        meta: { label: t('Error') },
      },
      {
        id: 'body_bytes',
        header: t('Body size'),
        size: 90,
        accessorFn: (entry) => entry.body_bytes,
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono tabular-nums'>
            {row.original.body_bytes > 0
              ? `${Math.ceil(row.original.body_bytes / 1024)} KB`
              : '—'}
          </span>
        ),
        meta: { label: t('Body size') },
      },
      {
        id: 'actions',
        header: t('Actions'),
        size: 90,
        cell: ({ row }) => (
          <div className='flex items-center gap-1'>
            <Button
              size='icon'
              variant='ghost'
              aria-label={t('View details')}
              onClick={() => onView(row.original)}
            >
              <Eye className='size-4' />
            </Button>
            <Button
              size='icon'
              variant='ghost'
              aria-label={t('Delete')}
              onClick={() => onDelete(row.original)}
            >
              <Trash2 className='size-4' />
            </Button>
          </div>
        ),
        meta: { label: t('Actions') },
      },
    ],
    [onView, onDelete, t]
  )
}
