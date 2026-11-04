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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import { searchUsers } from '@/features/users/api'
import type { User } from '@/features/users/types'
import { useDebounce } from '@/hooks/use-debounce'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'
import {
  getServerErrorStatus,
  getServerMessage,
} from '@/lib/server-error-message'

import { createUserSubscription } from '../../api'
import { formatDuration, formatPlanPrice } from '../../lib'
import { useSubscriptions } from '../subscriptions-provider'

const conflictingSubscriptionMessage =
  'This user already has an active subscription for another plan. Cancel it before adding a different plan.'

export function GrantSubscriptionDialog() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const { open, setOpen, currentRow, triggerRefresh, complianceConfirmed } =
    useSubscriptions()
  const [userSearch, setUserSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [granting, setGranting] = useState(false)
  const debouncedUserSearch = useDebounce(userSearch, 250)
  const plan = currentRow?.plan
  const isOpen = open === 'grant-subscription' && Boolean(currentRow?.plan.id)

  useEffect(() => {
    setReviewing(false)
    setUserSearch('')
    setSelectedUser(null)
  }, [isOpen, currentRow?.plan.id])

  const usersQuery = useQuery({
    queryKey: ['subscription-grant-users', debouncedUserSearch],
    queryFn: async () => {
      const response = await searchUsers({
        keyword: debouncedUserSearch.trim(),
        status: '1',
        p: 1,
        page_size: 20,
        sort_by: 'username',
        sort_order: 'asc',
      })
      if (!response.success) {
        throw new Error(response.message || t('Failed to search users'))
      }
      return response.data?.items || []
    },
    enabled: isOpen,
    staleTime: 30_000,
  })

  const searchingUsers =
    userSearch.trim() !== debouncedUserSearch.trim() || usersQuery.isFetching
  const users = useMemo(
    () => (searchingUsers ? [] : usersQuery.data || []),
    [searchingUsers, usersQuery.data]
  )
  const selectableUsers = useMemo(
    () =>
      selectedUser && !users.some((user) => user.id === selectedUser.id)
        ? [selectedUser, ...users]
        : users,
    [selectedUser, users]
  )
  const userOptions = useMemo(
    () =>
      selectableUsers.map((user) => ({
        value: String(user.id),
        label: `${user.display_name || user.username} (@${user.username})`,
        description: `${t('User ID')}: ${user.id} · ${t('Group')}: ${user.group || '-'}`,
      })),
    [selectableUsers, t]
  )
  let usersEmptyText = t('No users found')
  if (searchingUsers) usersEmptyText = t('Loading...')
  else if (usersQuery.isError) usersEmptyText = t('Failed to search users')
  const selectedUserLabel = selectedUser
    ? `${selectedUser.display_name || selectedUser.username} (@${selectedUser.username})`
    : ''

  const handleGrant = async () => {
    if (!plan?.id || !selectedUser) return
    setGranting(true)
    try {
      const response = await createUserSubscription(selectedUser.id, {
        plan_id: plan.id,
      })
      if (response.success) {
        toast.success(
          getServerMessage(response.data) ||
            t('Subscription granted successfully')
        )
        triggerRefresh()
        void queryClient.invalidateQueries({ queryKey: ['users'] })
        void queryClient.invalidateQueries({
          queryKey: ['subscription-grant-users'],
        })
        setOpen(null)
      } else {
        handleServerError(response)
      }
    } catch (error) {
      if (getServerErrorStatus(error) === 409) {
        toast.error(t(conflictingSubscriptionMessage))
      } else {
        handleServerError(error, t('Operation failed'))
      }
    } finally {
      setGranting(false)
    }
  }

  return (
    <>
      <Dialog
        open={isOpen && !reviewing}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !granting) setOpen(null)
        }}
        title={t('Gift subscription')}
        description={t(
          'Grant this plan to an active user without deducting their balance.'
        )}
        footer={
          <>
            <Button
              variant='outline'
              onClick={() => setOpen(null)}
              disabled={granting}
            >
              {t('Cancel')}
            </Button>
            <Button
              onClick={() => setReviewing(true)}
              disabled={!selectedUser || !complianceConfirmed}
            >
              {t('Review grant')}
            </Button>
          </>
        }
      >
        <div className='space-y-5'>
          <div className='bg-muted/40 flex items-start gap-3 rounded-lg border p-4'>
            <div className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full'>
              <Gift aria-hidden='true' className='size-4' />
            </div>
            <div className='min-w-0 space-y-1'>
              <div className='font-medium break-words'>
                {plan?.title || (plan?.id ? `#${plan.id}` : '-')}
              </div>
              {plan ? (
                <div className='text-muted-foreground text-sm'>
                  {formatPlanPrice(
                    Number(plan.price_amount || 0),
                    plan.currency,
                    locale
                  )}{' '}
                  · {formatDuration(plan, t)}
                </div>
              ) : null}
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='subscription-grant-user'>{t('Target user')}</Label>
            <Combobox
              id='subscription-grant-user'
              aria-label={t('Target user')}
              options={userOptions}
              filter={null}
              popupCollisionAvoidance={{
                side: 'shift',
                align: 'none',
                fallbackAxisSide: 'none',
              }}
              value={selectedUser ? String(selectedUser.id) : ''}
              onValueChange={(value) => {
                if (!value) return
                const user = selectableUsers.find(
                  (item) => String(item.id) === value
                )
                if (!user) return
                setSelectedUser(user)
                setUserSearch('')
              }}
              onSearchChange={(value: string) => {
                setUserSearch(value)
                setSelectedUser(null)
              }}
              placeholder={t('Search by username, name, or ID')}
              emptyText={usersEmptyText}
            />
            {selectedUser ? (
              <div className='bg-muted/50 text-muted-foreground rounded-md px-3 py-2 text-xs'>
                {selectedUserLabel} · {t('User ID')}: {selectedUser.id} ·{' '}
                {t('Group')}: {selectedUser.group || '-'}
              </div>
            ) : null}
          </div>

          <div className='text-muted-foreground bg-muted/40 rounded-md px-3 py-2 text-sm'>
            {t(
              'Same-plan grants extend the current expiry date. A user with another active plan must wait for it to expire or have it cancelled first.'
            )}
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={isOpen && reviewing}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !granting) {
            setReviewing(false)
            setOpen(null)
          }
        }}
        title={t('Grant "{{plan}}" to {{user}}?', {
          plan: plan?.title || '-',
          user: selectedUserLabel || '-',
        })}
        desc={t(
          "This grants the subscription for free and does not deduct the user's balance."
        )}
        confirmText={granting ? t('Processing...') : t('Grant')}
        disabled={!complianceConfirmed || !plan?.id || !selectedUser}
        isLoading={granting}
        handleConfirm={handleGrant}
      >
        <div className='space-y-2 rounded-lg border p-3 text-sm'>
          <div className='flex items-start justify-between gap-3'>
            <span className='text-muted-foreground'>{t('Plan')}</span>
            <span className='text-right font-medium'>{plan?.title || '-'}</span>
          </div>
          <div className='flex items-start justify-between gap-3'>
            <span className='text-muted-foreground'>{t('Target user')}</span>
            <span className='text-right font-medium'>
              {selectedUserLabel || '-'}
            </span>
          </div>
          <div className='flex items-start justify-between gap-3'>
            <span className='text-muted-foreground'>{t('Price')}</span>
            <span className='text-right font-medium'>
              {plan
                ? formatPlanPrice(
                    Number(plan.price_amount || 0),
                    plan.currency,
                    locale
                  )
                : '-'}
            </span>
          </div>
          <div className='flex items-start justify-between gap-3'>
            <span className='text-muted-foreground'>{t('Validity')}</span>
            <span className='text-right font-medium'>
              {plan ? formatDuration(plan, t) : '-'}
            </span>
          </div>
        </div>
      </ConfirmDialog>
    </>
  )
}
