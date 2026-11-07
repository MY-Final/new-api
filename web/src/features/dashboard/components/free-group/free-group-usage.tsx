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
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Hash, Hourglass } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTableServerPagination,
  StaticDataTable,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { useDebounce } from '@/hooks/use-debounce'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

type UserUsage = { user_id: number; username: string; count: number }
type Usage = {
  day: string
  today: string
  enabled: boolean
  group: string
  daily_limit: number
  user_limit: number
  used: number
  items: UserUsage[]
  total: number
}

export function FreeGroupUsage(props: { refetchInterval?: number | false }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [day, setDay] = useState('')
  const [username, setUsername] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const search = useDebounce(username.trim(), 300)
  const query = useQuery({
    queryKey: ['free-group', 'users', day, search, page, pageSize],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean
        message?: string
        data?: Usage
      }>('/api/free_group/users', {
        params: {
          day: day || undefined,
          username: search || undefined,
          p: page,
          page_size: pageSize,
        },
      })
      const payload = requireServerSuccess(response.data)
      if (!payload.data) {
        throw createServerError(payload, t('Failed to load statistics'))
      }
      return payload.data
    },
    refetchInterval: props.refetchInterval,
  })
  const usage = query.data
  const isToday = usage?.day === usage?.today
  const number = (value: number) => formatNumber(value, locale)
  const columns = [
    {
      id: 'user_id',
      header: t('User ID'),
      cell: (row: UserUsage) => row.user_id,
    },
    {
      id: 'username',
      header: t('Username'),
      cell: (row: UserUsage) => row.username || `#${row.user_id}`,
    },
    {
      id: 'count',
      header: t('Calls used'),
      cell: (row: UserUsage) => number(row.count),
    },
    ...(isToday && usage?.enabled
      ? [
          {
            id: 'limit',
            header: t('Daily limit per user'),
            cell: () =>
              usage.user_limit > 0 ? number(usage.user_limit) : t('Unlimited'),
          },
        ]
      : []),
  ]

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Input
          type='date'
          aria-label={t('Date')}
          value={day || usage?.day || ''}
          max={usage?.today}
          className='w-auto'
          onChange={(event) => {
            if (event.target.value) {
              setDay(event.target.value)
              setPage(1)
            }
          }}
        />
        <Input
          aria-label={t('Username')}
          placeholder={t('Search username')}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value)
            setPage(1)
          }}
          className='w-full sm:w-64'
        />
      </div>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Free group usage resets at midnight UTC+8. Counts include reserved calls that may later fail.'
        )}
      </p>
      {query.isPending && <Skeleton className='h-48 w-full' />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {!query.isPending && !query.isError && usage && (
        <>
          {isToday && usage.enabled && (
            <p className='text-sm'>
              {t('Free group')}: {usage.group}
            </p>
          )}
          <div className='grid gap-3 sm:grid-cols-3'>
            <div className='bg-card rounded-xl border p-4'>
              <StatCard
                title={t('Calls used')}
                value={number(usage.used)}
                description=''
                icon={Hash}
                compact
              />
            </div>
            {isToday && usage.enabled && (
              <>
                <div className='bg-card rounded-xl border p-4'>
                  <StatCard
                    title={t('Daily limit')}
                    value={number(usage.daily_limit)}
                    description=''
                    icon={CalendarDays}
                    compact
                  />
                </div>
                <div className='bg-card rounded-xl border p-4'>
                  <StatCard
                    title={t('Remaining today')}
                    value={number(Math.max(usage.daily_limit - usage.used, 0))}
                    description=''
                    icon={Hourglass}
                    compact
                  />
                </div>
              </>
            )}
          </div>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Historical counts are not separated by free group when settings change.'
            )}
          </p>
          <StaticDataTable
            columns={columns}
            data={usage.items}
            getRowKey={(row) => row.user_id}
            emptyContent={t('No records found. Try adjusting your filters.')}
          />
          <DataTableServerPagination
            page={page}
            pageSize={pageSize}
            total={usage.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </>
      )}
    </div>
  )
}
