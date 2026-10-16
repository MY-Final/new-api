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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { searchUsers } from '@/features/users/api'
import type { User } from '@/features/users/types'
import { useDebounce } from '@/hooks/use-debounce'
import { useMediaQuery } from '@/hooks/use-media-query'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { RefundQueueFilters } from '../types'

export function RefundQueueFilterBar(props: {
  initialRequestId?: string
  onApply: (filters: RefundQueueFilters) => void
}) {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [draft, setDraft] = useState<RefundQueueFilters>({
    request_id: props.initialRequestId,
    status: 'unrefunded',
  })
  const [userSearch, setUserSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const search = useDebounce(userSearch.trim(), 250)
  const users = useQuery({
    queryKey: ['finance-refund-users', search],
    queryFn: async () => {
      const response = await searchUsers({
        keyword: search,
        p: 1,
        page_size: 20,
        sort_by: 'username',
        sort_order: 'asc',
      })
      return requireServerSuccess(response).data?.items || []
    },
    retry: false,
    staleTime: 30_000,
    meta: { errorToast: false },
  })
  const searching = search !== userSearch.trim() || users.isFetching
  const options = useMemo(() => {
    const items = searching ? [] : users.data || []
    const all =
      selectedUser && !items.some((user) => user.id === selectedUser.id)
        ? [selectedUser, ...items]
        : items
    return all.map((user) => ({
      value: String(user.id),
      label: `${user.display_name || user.username} (@${user.username}) · #${user.id}`,
    }))
  }, [searching, selectedUser, users.data])
  let emptyText = t('No users found')
  if (searching) emptyText = t('Loading...')
  else if (users.isError) emptyText = t('Failed to search users')
  const invalidRange =
    !!draft.start_time && !!draft.end_time && draft.end_time < draft.start_time
  const form = (
    <form
      className='bg-card shrink-0 rounded-xl border p-3'
      onSubmit={(event) => {
        event.preventDefault()
        props.onApply(draft)
        setMobileOpen(false)
      }}
    >
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <div className='space-y-1.5'>
          <Label htmlFor='refund-queue-user'>{t('User')}</Label>
          <Combobox
            openOnFocus
            id='refund-queue-user'
            aria-label={t('User')}
            filter={null}
            options={options}
            value={selectedUser ? String(selectedUser.id) : ''}
            placeholder={t('Search by username, name, or ID')}
            emptyText={emptyText}
            onSearchChange={(value: string) => {
              setUserSearch(value)
              setSelectedUser(null)
              setDraft((old) => ({ ...old, user_id: undefined }))
            }}
            onValueChange={(value) => {
              const user = users.data?.find((item) => String(item.id) === value)
              if (user) {
                setSelectedUser(user)
                setDraft((old) => ({ ...old, user_id: user.id }))
              }
            }}
          />
          {users.isError && !searching ? (
            <ErrorState
              className='min-h-0 py-2'
              title={t('Failed to search users')}
              onRetry={() => void users.refetch()}
            />
          ) : null}
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='refund-queue-request'>{t('Request ID')}</Label>
          <Input
            id='refund-queue-request'
            maxLength={64}
            value={draft.request_id || ''}
            placeholder={t('Exact request ID')}
            onChange={(event) =>
              setDraft({
                ...draft,
                request_id: event.target.value.trim() || undefined,
              })
            }
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='refund-queue-model'>{t('Model')}</Label>
          <Input
            id='refund-queue-model'
            maxLength={255}
            value={draft.model_name || ''}
            placeholder={t('Exact model name')}
            onChange={(event) =>
              setDraft({
                ...draft,
                model_name: event.target.value || undefined,
              })
            }
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='refund-queue-channel'>{t('Channel ID')}</Label>
          <Input
            id='refund-queue-channel'
            type='number'
            min={1}
            step={1}
            value={draft.channel_id || ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                channel_id: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='refund-queue-funding'>{t('Funding source')}</Label>
          <Combobox
            id='refund-queue-funding'
            aria-label={t('Funding source')}
            value={draft.funding_source || 'all'}
            options={[
              { value: 'all', label: t('All') },
              { value: 'wallet', label: t('Wallet') },
              { value: 'subscription', label: t('Subscription') },
            ]}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                funding_source:
                  value === 'wallet' || value === 'subscription'
                    ? value
                    : undefined,
              })
            }
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='refund-queue-status'>{t('Refund status')}</Label>
          <Combobox
            id='refund-queue-status'
            aria-label={t('Refund status')}
            value={draft.status || 'all'}
            options={[
              { value: 'all', label: t('All') },
              { value: 'unrefunded', label: t('Unrefunded') },
              { value: 'refunded', label: t('Refunded') },
            ]}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                status:
                  value === 'unrefunded' || value === 'refunded'
                    ? value
                    : undefined,
              })
            }
          />
        </div>
        <div className='space-y-1.5 sm:col-span-2'>
          <Label>{t('Date Range')}</Label>
          <CompactDateTimeRangePicker
            start={
              draft.start_time ? new Date(draft.start_time * 1000) : undefined
            }
            end={draft.end_time ? new Date(draft.end_time * 1000) : undefined}
            onChange={(range) =>
              setDraft({
                ...draft,
                start_time: range.start
                  ? Math.floor(range.start.getTime() / 1000)
                  : undefined,
                end_time: range.end
                  ? Math.floor(range.end.getTime() / 1000)
                  : undefined,
              })
            }
          />
        </div>
      </div>
      {invalidRange ? (
        <p role='alert' className='text-destructive mt-2 text-sm'>
          {t('Invalid time range')}
        </p>
      ) : null}
      <div className='mt-3 flex flex-wrap items-center gap-2'>
        <Button
          type='submit'
          size='sm'
          disabled={invalidRange || (!!userSearch.trim() && !selectedUser)}
        >
          {t('Apply filters')}
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => {
            setDraft({ status: 'unrefunded' })
            setUserSearch('')
            setSelectedUser(null)
            props.onApply({ status: 'unrefunded' })
            setMobileOpen(false)
          }}
        >
          {t('Reset filters')}
        </Button>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Select a user from search results, or leave empty for all users.'
          )}
        </p>
      </div>
    </form>
  )
  if (!isMobile) return form
  return (
    <Dialog
      open={mobileOpen}
      onOpenChange={setMobileOpen}
      initialFocus={false}
      title={t('Filter')}
      trigger={
        <Button variant='outline' size='sm' className='shrink-0 self-start'>
          {t('Filter')}
        </Button>
      }
    >
      {form}
    </Dialog>
  )
}
