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
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Mail } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { handleServerError } from '@/lib/handle-server-error'

import { getEmailReminder, updateEmailReminder } from '../api'
import type { EmailReminderAction, EmailReminderState } from '../types'

const EMAIL_REMINDER_QUERY_KEY = ['user', 'email-reminder'] as const

/**
 * One-time binding prompt for accounts that cannot receive scheduled mail.
 * The server owns the decision, so every device and reload agrees. Closing the
 * dialog only snoozes it for today; it never means "never remind me".
 */
export function EmailBindingPrompt() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const pathname = useLocation({ select: (location) => location.pathname })
  const [dismissed, setDismissed] = useState(false)

  const reminderQuery = useQuery({
    queryKey: EMAIL_REMINDER_QUERY_KEY,
    queryFn: async () => {
      const response = await getEmailReminder()
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to load reminder state')
      }
      return response.data
    },
    // The security page already exposes the binding flow, so no prompt (and no
    // extra request) is needed there.
    enabled: !pathname.startsWith('/security'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 0,
  })

  const mutation = useMutation({
    mutationFn: async (action: EmailReminderAction) => {
      const response = await updateEmailReminder(action)
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to update reminder')
      }
      return response.data
    },
    onSuccess: (data: EmailReminderState) => {
      queryClient.setQueryData(EMAIL_REMINDER_QUERY_KEY, data)
      setDismissed(true)
    },
    onError: (error) => {
      handleServerError(error, t('Failed to update reminder settings'))
    },
  })

  if (pathname.startsWith('/security')) {
    return null
  }

  const open = Boolean(reminderQuery.data?.should_prompt) && !dismissed
  const choose = (action: EmailReminderAction) => {
    mutation.mutate(action)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || mutation.isPending) {
          return
        }
        // A plain close is a "today" snooze, never a permanent opt-out.
        setDismissed(true)
        choose('snooze_today')
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Mail className='size-4' aria-hidden='true' />
            {t('Bind your email to get usage notifications')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'After binding and verifying an email, you can receive the daily usage summary and other email notifications. You can also do this later.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className='flex-col gap-2 sm:flex-col'>
          <Button
            className='w-full'
            disabled={mutation.isPending}
            onClick={() => {
              setDismissed(true)
              navigate({ to: '/security' })
            }}
          >
            {t('Bind now')}
          </Button>
          <div className='grid w-full grid-cols-1 gap-2 sm:grid-cols-3'>
            <Button
              variant='outline'
              disabled={mutation.isPending}
              onClick={() => choose('snooze_week')}
            >
              {t('Do not remind me for 7 days')}
            </Button>
            <Button
              variant='outline'
              disabled={mutation.isPending}
              onClick={() => choose('snooze_today')}
            >
              {t('Do not remind me today')}
            </Button>
            <Button
              variant='ghost'
              disabled={mutation.isPending}
              onClick={() => choose('off')}
            >
              {t('Not now')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
