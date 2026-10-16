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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { searchUsers } from '@/features/users/api'
import type { User } from '@/features/users/types'
import { useDebounce } from '@/hooks/use-debounce'
import { formatQuotaPrecise, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

import {
  getRequestBillings,
  getUserRequestBillings,
  refundRequestBilling,
} from '../api'
import type { RequestBilling } from '../types'

type SearchMode = 'request' | 'user'
type RefundBatch = { records: RequestBilling[]; reason: string }

const requestPageSize = 20

function canRefund(record: RequestBilling) {
  return (
    !record.blocked_reason &&
    record.settled &&
    record.refunded_quota <= 0 &&
    record.quota > 0
  )
}

export function RequestRefundDialog(props: {
  requestId?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [searchMode, setSearchMode] = useState<SearchMode>('request')
  const [input, setInput] = useState(props.requestId || '')
  const [requestId, setRequestId] = useState(props.requestId || '')
  const [userSearch, setUserSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [userPage, setUserPage] = useState(1)
  const [knownRecords, setKnownRecords] = useState<
    Record<string, RequestBilling>
  >({})
  const [selectedBillingIds, setSelectedBillingIds] = useState<Set<string>>(
    new Set()
  )
  const [selectedRecords, setSelectedRecords] = useState<
    RequestBilling[] | null
  >(null)
  const [reason, setReason] = useState('')
  const debouncedUserSearch = useDebounce(userSearch, 250)

  const requestQuery = useQuery({
    queryKey: ['finance-request-billings', requestId],
    queryFn: () => getRequestBillings(requestId),
    enabled: searchMode === 'request' && !!requestId,
    retry: false,
    meta: { errorToast: false },
  })
  const usersQuery = useQuery({
    queryKey: ['finance-refund-users', debouncedUserSearch],
    queryFn: async () => {
      const response = await searchUsers({
        keyword: debouncedUserSearch.trim(),
        p: 1,
        page_size: 20,
        sort_by: 'username',
        sort_order: 'asc',
      })
      requireServerSuccess(response)
      return response.data?.items || []
    },
    enabled: searchMode === 'user',
    retry: false,
    meta: { errorToast: false },
    staleTime: 30_000,
  })
  const userBillingQuery = useQuery({
    queryKey: ['finance-user-request-billings', selectedUser?.id, userPage],
    queryFn: () =>
      getUserRequestBillings(selectedUser?.id || 0, userPage, requestPageSize),
    enabled: searchMode === 'user' && !!selectedUser,
    retry: false,
    meta: { errorToast: false },
  })

  const searchingUsers =
    userSearch.trim() !== debouncedUserSearch.trim() || usersQuery.isFetching
  let userSearchEmptyText = t('No users found')
  if (searchingUsers) userSearchEmptyText = t('Loading...')
  else if (usersQuery.isError) userSearchEmptyText = t('Failed to search users')
  const users = useMemo(
    () => (searchingUsers ? [] : usersQuery.data || []),
    [searchingUsers, usersQuery.data]
  )
  const userOptions = useMemo(() => {
    const options =
      selectedUser && !users.some((user) => user.id === selectedUser.id)
        ? [selectedUser, ...users]
        : users
    return options.map((user) => ({
      value: String(user.id),
      label: `${user.display_name || user.username} (@${user.username}) · ${t('User ID')}: ${user.id}`,
    }))
  }, [selectedUser, t, users])

  const records = useMemo(
    () =>
      searchMode === 'request'
        ? requestQuery.data || []
        : userBillingQuery.data?.items || [],
    [requestQuery.data, searchMode, userBillingQuery.data?.items]
  )
  const activeQuery = searchMode === 'request' ? requestQuery : userBillingQuery
  const total =
    searchMode === 'request'
      ? records.length
      : userBillingQuery.data?.total || 0
  const pageCount = Math.max(1, Math.ceil(total / requestPageSize))

  useEffect(() => {
    if (records.length === 0) return
    setKnownRecords((previous) => {
      const next = { ...previous }
      for (const record of records) next[record.billing_id] = record
      return next
    })
  }, [records])

  const selected = useMemo(
    () =>
      [...selectedBillingIds]
        .map((id) => knownRecords[id])
        .filter((record): record is RequestBilling => !!record),
    [knownRecords, selectedBillingIds]
  )
  const refundableOnPage = records.filter(canRefund)
  const allOnPageSelected =
    refundableOnPage.length > 0 &&
    refundableOnPage.every((record) =>
      selectedBillingIds.has(record.billing_id)
    )

  const clearSelection = () => setSelectedBillingIds(new Set())
  const changeMode = (mode: SearchMode) => {
    setSearchMode(mode)
    clearSelection()
    setSelectedRecords(null)
    setReason('')
    if (mode === 'user') {
      setRequestId('')
    } else {
      setSelectedUser(null)
      setUserSearch('')
      setUserPage(1)
    }
  }
  const toggleRecord = (record: RequestBilling, checked: boolean) => {
    setSelectedBillingIds((previous) => {
      const next = new Set(previous)
      if (checked) next.add(record.billing_id)
      else next.delete(record.billing_id)
      return next
    })
  }
  const togglePage = () => {
    setSelectedBillingIds((previous) => {
      const next = new Set(previous)
      if (allOnPageSelected) {
        for (const record of refundableOnPage) next.delete(record.billing_id)
      } else {
        for (const record of refundableOnPage) next.add(record.billing_id)
      }
      return next
    })
  }

  const mutation = useMutation({
    mutationFn: async (batch: RefundBatch) => {
      const results = await Promise.allSettled(
        batch.records.map((record) =>
          refundRequestBilling(record.billing_id, batch.reason)
        )
      )
      return {
        succeeded: batch.records.filter(
          (_, index) => results[index].status === 'fulfilled'
        ),
        failed: batch.records.filter(
          (_, index) => results[index].status === 'rejected'
        ),
      }
    },
    onSuccess: (result) => {
      if (result.failed.length === 0) {
        toast.success(
          t('Refunded {{count}} requests', { count: result.succeeded.length })
        )
      } else {
        toast.error(
          t('{{succeeded}} refunded; {{failed}} failed', {
            succeeded: result.succeeded.length,
            failed: result.failed.length,
          })
        )
      }
      setSelectedRecords(null)
      setSelectedBillingIds(
        new Set(result.failed.map((record) => record.billing_id))
      )
      for (const key of [
        'finance',
        'finance-request-billings',
        'finance-user-request-billings',
        'logs',
        'usage-logs-stats',
        'ledger',
        'self',
        'users',
        'user-usage',
        'usage-statistics',
        'quota-usage-daily',
      ]) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
    onError: (error) =>
      handleServerError(error, t('Financial operation failed')),
  })

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) props.onClose()
        }}
        title={t('Refund request')}
        description={t(
          'Search one request or select multiple requests from a user.'
        )}
        contentClassName='sm:max-w-3xl'
        bodyClassName='space-y-4'
      >
        <div className='bg-muted inline-flex w-full rounded-lg p-1 sm:w-auto'>
          <Button
            size='sm'
            variant={searchMode === 'request' ? 'secondary' : 'ghost'}
            onClick={() => changeMode('request')}
          >
            {t('By request ID')}
          </Button>
          <Button
            size='sm'
            variant={searchMode === 'user' ? 'secondary' : 'ghost'}
            onClick={() => changeMode('user')}
          >
            {t('By user')}
          </Button>
        </div>

        {searchMode === 'request' ? (
          <form
            className='space-y-2'
            onSubmit={(event) => {
              event.preventDefault()
              setSelectedBillingIds(new Set())
              setRequestId(input.trim())
              if (input.trim() === requestId) void requestQuery.refetch()
            }}
          >
            <Label htmlFor='refund-request-id'>{t('Request ID')}</Label>
            <div className='flex min-w-0 gap-2'>
              <Input
                id='refund-request-id'
                value={input}
                maxLength={64}
                onChange={(event) => setInput(event.target.value)}
                className='min-w-0 font-mono'
              />
              <Button
                type='submit'
                disabled={!input.trim() || requestQuery.isFetching}
              >
                {t('Search')}
              </Button>
            </div>
          </form>
        ) : (
          <div className='space-y-2'>
            <Label htmlFor='refund-user-search'>{t('User')}</Label>
            <Combobox
              id='refund-user-search'
              aria-label={t('User')}
              options={userOptions}
              filter={null}
              value={selectedUser ? String(selectedUser.id) : ''}
              onValueChange={(value) => {
                const user =
                  users.find((item) => String(item.id) === value) ||
                  (selectedUser?.id === Number(value) ? selectedUser : null)
                if (!user) return
                setSelectedUser(user)
                setUserPage(1)
                clearSelection()
              }}
              onSearchChange={(value: string) => {
                setUserSearch(value)
                setSelectedUser(null)
                clearSelection()
              }}
              placeholder={t('Search by username, name, or ID')}
              emptyText={userSearchEmptyText}
            />
            {usersQuery.isError && !searchingUsers ? (
              <ErrorState
                title={getServerErrorMessage(
                  usersQuery.error,
                  t('Failed to search users')
                )}
                onRetry={() => void usersQuery.refetch()}
              />
            ) : null}
            {selectedUser ? (
              <p className='text-muted-foreground text-xs'>
                {selectedUser.display_name || selectedUser.username} ·{' '}
                {t('User ID')}: {selectedUser.id}
              </p>
            ) : null}
          </div>
        )}

        {!requestId && searchMode === 'request' ? (
          <p className='text-muted-foreground text-sm'>
            {t('Enter the request ID from a consumption log.')}
          </p>
        ) : null}
        {searchMode === 'user' && !selectedUser ? (
          <p className='text-muted-foreground text-sm'>
            {t('Select a user to list request charges.')}
          </p>
        ) : null}
        {activeQuery.isFetching ? <LoadingState /> : null}
        {activeQuery.isError ? (
          <ErrorState
            title={getServerErrorMessage(
              activeQuery.error,
              t('Financial operation failed')
            )}
            onRetry={() => void activeQuery.refetch()}
          />
        ) : null}
        {!activeQuery.isFetching &&
        !activeQuery.isError &&
        (searchMode === 'request' ? requestId : selectedUser) &&
        records.length === 0 ? (
          <EmptyState
            title={t(
              searchMode === 'request'
                ? 'No refundable billing record was found for this request'
                : 'No refundable billing record was found for this user'
            )}
          />
        ) : null}
        <p className='text-muted-foreground text-xs'>
          {t(
            'Historical requests without an original billing allocation cannot be refunded automatically.'
          )}
        </p>

        {records.length > 0 && !activeQuery.isError ? (
          <>
            <div className='flex flex-wrap items-center justify-between gap-2 border-b pb-2'>
              <div className='flex items-center gap-2 text-sm'>
                <Checkbox
                  aria-label={t('Select refundable on this page')}
                  checked={allOnPageSelected}
                  disabled={refundableOnPage.length === 0}
                  onCheckedChange={togglePage}
                />
                <span className='text-muted-foreground'>
                  {t('Selected')}: {selected.length}
                </span>
              </div>
              <div className='flex flex-wrap gap-2'>
                {selected.length > 0 ? (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={mutation.isPending}
                    onClick={() => {
                      setReason('')
                      setSelectedRecords(selected)
                    }}
                  >
                    {t('Refund selected')} ({selected.length})
                  </Button>
                ) : null}
                {selected.length > 0 ? (
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={mutation.isPending}
                    onClick={clearSelection}
                  >
                    {t('Clear selection')}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className='max-h-[min(48vh,520px)] space-y-3 overflow-y-auto pr-1'>
              {records.map((record) => {
                const refunded = record.refunded_quota > 0
                let status = 'Settled'
                if (!record.settled) status = 'Pending'
                if (record.blocked_reason && record.settled) {
                  status = 'Unavailable'
                }
                if (refunded) status = 'Refunded'
                return (
                  <article
                    key={record.billing_id}
                    className='min-w-0 space-y-3 rounded-lg border p-4'
                  >
                    <div className='flex flex-wrap items-start justify-between gap-2'>
                      <div className='flex min-w-0 items-start gap-3'>
                        <Checkbox
                          aria-label={`${t('Select')} ${record.request_id}`}
                          checked={selectedBillingIds.has(record.billing_id)}
                          disabled={!canRefund(record) || mutation.isPending}
                          onCheckedChange={(checked) =>
                            toggleRecord(record, checked === true)
                          }
                        />
                        <div className='min-w-0'>
                          <p className='font-medium break-all'>
                            {record.username || record.user_id} ·{' '}
                            {record.model_name}
                          </p>
                          <p className='text-muted-foreground text-xs'>
                            {formatTimestampToDate(record.created_at)}
                          </p>
                        </div>
                      </div>
                      <StatusBadge
                        label={t(status)}
                        variant={record.blocked_reason ? 'warning' : 'neutral'}
                        copyable={false}
                      />
                    </div>
                    <div className='text-muted-foreground flex min-w-0 items-center gap-1 text-xs'>
                      <span className='min-w-0 break-all'>
                        {record.request_id}
                      </span>
                      <CopyButton
                        value={record.request_id}
                        size='icon'
                        className='size-7 shrink-0'
                      />
                    </div>
                    <dl className='grid grid-cols-1 gap-3 text-sm sm:grid-cols-3'>
                      <div>
                        <dt className='text-muted-foreground'>
                          {t('Original charge')}
                        </dt>
                        <dd className='font-semibold tabular-nums'>
                          {formatQuotaPrecise(record.quota)}
                        </dd>
                      </div>
                      <div>
                        <dt className='text-muted-foreground'>
                          {t('Refunded amount')}
                        </dt>
                        <dd className='tabular-nums'>
                          {formatQuotaPrecise(record.refunded_quota)}
                        </dd>
                      </div>
                      <div>
                        <dt className='text-muted-foreground'>
                          {t('Refundable amount')}
                        </dt>
                        <dd className='font-semibold tabular-nums'>
                          {formatQuotaPrecise(
                            refunded || record.blocked_reason ? 0 : record.quota
                          )}
                        </dd>
                      </div>
                    </dl>
                    <p className='text-muted-foreground text-sm'>
                      {record.funding_source === 'subscription'
                        ? `${t('Subscription')} #${record.subscription_id}`
                        : `${t('Bonus quota')}: ${formatQuotaPrecise(record.bonus_quota)} · ${t('Paid quota')}: ${formatQuotaPrecise(record.paid_quota)}`}
                    </p>
                    {record.blocked_reason && !refunded ? (
                      <p role='status' className='text-warning text-sm'>
                        {t(record.blocked_reason)}
                      </p>
                    ) : null}
                    {refunded ? (
                      <p
                        role='status'
                        className='text-muted-foreground text-sm'
                      >
                        {t('This request has already been refunded')} · #
                        {record.refund_operation_id}
                      </p>
                    ) : (
                      <Button
                        variant='outline'
                        disabled={!canRefund(record) || mutation.isPending}
                        onClick={() => {
                          setReason('')
                          setSelectedRecords([record])
                        }}
                      >
                        {t('Refund full amount')}
                      </Button>
                    )}
                  </article>
                )
              })}
            </div>
            {searchMode === 'user' && pageCount > 1 ? (
              <div className='flex items-center justify-between gap-2 border-t pt-2'>
                <Button
                  size='icon'
                  variant='ghost'
                  aria-label={t('Previous page')}
                  disabled={userPage <= 1 || userBillingQuery.isFetching}
                  onClick={() => setUserPage((page) => Math.max(1, page - 1))}
                >
                  <ChevronLeft aria-hidden='true' />
                </Button>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {t('Page')} {userPage} / {pageCount} · {total}
                </span>
                <Button
                  size='icon'
                  variant='ghost'
                  aria-label={t('Next page')}
                  disabled={
                    userPage >= pageCount || userBillingQuery.isFetching
                  }
                  onClick={() =>
                    setUserPage((page) => Math.min(pageCount, page + 1))
                  }
                >
                  <ChevronRight aria-hidden='true' />
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={!!selectedRecords}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setSelectedRecords(null)
        }}
        title={t('Confirm request refund')}
        desc={
          selectedRecords
            ? `${t('{{count}} requests selected', {
                count: selectedRecords.length,
              })} · ${formatQuotaPrecise(
                selectedRecords.reduce((sum, record) => sum + record.quota, 0)
              )}`
            : ''
        }
        confirmText={
          selectedRecords?.length && selectedRecords.length > 1
            ? t('Refund selected')
            : t('Refund full amount')
        }
        isLoading={mutation.isPending}
        disabled={!reason.trim()}
        handleConfirm={() => {
          if (selectedRecords && reason.trim()) {
            mutation.mutate({ records: selectedRecords, reason: reason.trim() })
          }
        }}
      >
        <p className='text-muted-foreground text-sm'>
          {t('Return the settled charge to its original funding source.')}
        </p>
        <div className='space-y-2'>
          <Label htmlFor='request-refund-reason'>{t('Refund reason')}</Label>
          <Input
            id='request-refund-reason'
            value={reason}
            maxLength={255}
            disabled={mutation.isPending}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </ConfirmDialog>
    </>
  )
}
