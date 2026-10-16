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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { Combobox } from '@/components/ui/combobox'
import { searchUsers } from '@/features/users/api'
import type { User } from '@/features/users/types'
import { useDebounce } from '@/hooks/use-debounce'
import { requireServerSuccess } from '@/lib/server-error-message'

export function FinanceUserFilter(props: {
  value?: number
  onChange: (value?: number) => void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<User | null>(null)
  const keyword = useDebounce(search.trim(), 250)
  const query = useQuery({
    queryKey: ['finance-refund-users', keyword],
    queryFn: async () =>
      requireServerSuccess(
        await searchUsers({
          keyword,
          p: 1,
          page_size: 20,
          sort_by: 'username',
          sort_order: 'asc',
        })
      ).data?.items || [],
    retry: false,
    staleTime: 30_000,
    meta: { errorToast: false },
  })
  const searching = query.isFetching || keyword !== search.trim()
  const users = searching ? [] : query.data || []
  const options = [
    ...(selected &&
    selected.id === props.value &&
    !users.some((user) => user.id === selected.id)
      ? [selected]
      : []),
    ...users,
  ].map((user) => ({
    value: String(user.id),
    label: `${user.display_name || user.username} (@${user.username}) · #${user.id}`,
  }))
  let emptyText = t('No users found')
  if (searching) emptyText = t('Loading...')
  else if (query.isError) emptyText = t('Failed to search users')
  return (
    <div className='w-full sm:w-64'>
      <Combobox
        aria-label={t('User')}
        openOnFocus
        options={options}
        value={props.value ? String(props.value) : ''}
        filter={null}
        placeholder={t('Search by username, name, or ID')}
        emptyText={emptyText}
        onSearchChange={(value: string) => {
          setSearch(value)
          props.onChange(undefined)
        }}
        onValueChange={(value) => {
          const user = users.find((item) => String(item.id) === value)
          if (!user) return
          setSelected(user)
          props.onChange(user.id)
        }}
      />
      {query.isError && !searching ? (
        <ErrorState
          className='min-h-0 py-2'
          title={t('Failed to search users')}
          onRetry={() => void query.refetch()}
        />
      ) : null}
    </div>
  )
}
