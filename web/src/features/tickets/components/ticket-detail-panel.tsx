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
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { hasPermission } from '@/lib/admin-permissions'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { changeTicket, getTicket, readTicket } from '../api'
import { ticketCategories, ticketStatuses } from '../constants'
import type { TicketStatus } from '../types'
import { TicketComposer } from './ticket-composer'
import { TicketScreenshot } from './ticket-screenshot'
import { TicketSelect } from './ticket-select'
import { TicketStatusBadge } from './ticket-status-badge'

export function TicketDetailPanel(props: {
  id: number
  staff: boolean
  variant?: 'dialog' | 'pane'
  onBack?: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const canReply = !props.staff || hasPermission(user, 'ticket', 'write')
  const canManage = props.staff && hasPermission(user, 'ticket', 'operate')
  const [before, setBefore] = useState(0)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [assignee, setAssignee] = useState('')
  const query = useQuery({
    queryKey: ['tickets', 'detail', props.staff, user?.id, props.id, before],
    queryFn: () => getTicket(props.staff, props.id, before),
    refetchInterval: before === 0 ? 30000 : false,
  })
  const read = useMutation({
    mutationFn: (version: number) => readTicket(props.staff, props.id, version),
    onSuccess: (_result, version) => {
      readVersion.current = Math.max(readVersion.current, version)
      void client.invalidateQueries({ queryKey: ['tickets', 'unread'] })
      void client.invalidateQueries({ queryKey: ['tickets', 'list'] })
      void client.invalidateQueries({ queryKey: ['tickets', 'stats'] })
    },
    retry: 1,
  })
  const version = query.data?.ticket.version
  const readVersion = useRef(0)
  const markRead = read.mutate
  useEffect(() => {
    if (version && before === 0 && version > readVersion.current) {
      markRead(version)
    }
  }, [version, before, markRead])
  const update = useMutation({
    mutationFn: (input: { status?: TicketStatus; assignee?: number }) =>
      changeTicket(
        props.staff,
        props.id,
        query.data?.ticket.version ?? 0,
        input.status,
        input.assignee
      ),
    onSuccess: () => {
      setCloseConfirm(false)
      void client.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (error) => handleServerError(error, t('Ticket operation failed')),
  })
  const ticket = query.data?.ticket
  const senderLabels = new Map<number, string>()
  for (const message of query.data?.messages ?? []) {
    if (message.sender_type === 'note') {
      senderLabels.set(message.id, t('Internal note'))
      continue
    }
    if (props.staff && message.sender_name) {
      senderLabels.set(
        message.id,
        `${message.sender_name} (#${message.sender_id})`
      )
      continue
    }
    const role = t(message.sender_type === 'admin' ? 'Support' : 'User')
    senderLabels.set(
      message.id,
      props.staff ? `${role} #${message.sender_id}` : role
    )
  }
  return (
    <>
      <div className='flex min-w-0 flex-col gap-4'>
        <div className='flex min-w-0 items-center gap-2'>
          {props.onBack && (
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label={t('Back')}
              className='lg:hidden'
              onClick={props.onBack}
            >
              <ArrowLeft />
            </Button>
          )}
          <h3 className='min-w-0 flex-1 text-base font-semibold [overflow-wrap:anywhere] break-words'>
            {ticket ? `#${ticket.id} · ${ticket.title}` : t('Ticket details')}
          </h3>
          {ticket && <TicketStatusBadge status={ticket.status} />}
        </div>
        {query.isPending && <LoadingState />}
        {query.isError && (
          <ErrorState
            onRetry={() => {
              void query.refetch()
            }}
          />
        )}
        {ticket && query.data && (
          <div
            className={cn(
              'flex min-w-0 flex-col gap-4',
              (props.variant ?? 'dialog') === 'dialog' &&
                'lg:grid lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-6'
            )}
          >
            <section
              className='min-w-0 space-y-4'
              aria-label={t('Conversation')}
            >
              <div className='flex flex-wrap gap-2'>
                {query.data.has_more && (
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setBefore(query.data?.messages[0]?.id ?? 0)}
                  >
                    {t('Older messages')}
                  </Button>
                )}
                {before > 0 && (
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setBefore(0)}
                  >
                    {t('Latest messages')}
                  </Button>
                )}
              </div>
              {query.data.messages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    'space-y-2 rounded-lg border p-4',
                    message.sender_type === 'note'
                      ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'
                      : 'bg-muted/20'
                  )}
                >
                  <div className='flex flex-wrap items-center justify-between gap-2 text-xs'>
                    <span className='font-medium'>
                      {senderLabels.get(message.id)}
                    </span>
                    <time className='text-muted-foreground'>
                      {formatTimestampToDate(message.created_at)}
                    </time>
                  </div>
                  <p className='text-sm [overflow-wrap:anywhere] break-words whitespace-pre-wrap'>
                    {message.content}
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    {message.attachments.map((attachment) => (
                      <TicketScreenshot
                        key={attachment.id}
                        attachment={attachment}
                        ticketId={props.id}
                        staff={props.staff}
                      />
                    ))}
                  </div>
                </article>
              ))}
              <TicketComposer
                id={props.id}
                staff={props.staff}
                canReply={canReply}
                canManage={canManage}
              />
            </section>
            <aside
              className={cn(
                'min-w-0 space-y-4 text-sm',
                props.variant === 'pane' && 'rounded-lg border p-4'
              )}
              aria-label={t('Ticket details')}
            >
              <TicketStatusBadge status={ticket.status} />
              <dl className='space-y-3 [overflow-wrap:anywhere] break-words'>
                <div>
                  <dt className='text-muted-foreground'>{t('Category')}</dt>
                  <dd>{t(ticketCategories[ticket.category])}</dd>
                </div>
                <div>
                  <dt className='text-muted-foreground'>{t('Created at')}</dt>
                  <dd>{formatTimestampToDate(ticket.created_at)}</dd>
                </div>
                {props.staff && (
                  <div>
                    <dt className='text-muted-foreground'>{t('User ID')}</dt>
                    <dd>
                      {query.data.requester
                        ? `${query.data.requester.username} (#${ticket.user_id})`
                        : ticket.user_id}
                    </dd>
                  </div>
                )}
                {props.staff && query.data.requester?.email && (
                  <div>
                    <dt className='text-muted-foreground'>{t('Email')}</dt>
                    <dd>{query.data.requester.email}</dd>
                  </div>
                )}
                {ticket.request_id && (
                  <div>
                    <dt className='text-muted-foreground'>{t('Request ID')}</dt>
                    <dd>{ticket.request_id}</dd>
                  </div>
                )}
                {ticket.order_number && (
                  <div>
                    <dt className='text-muted-foreground'>
                      {t('Order number')}
                    </dt>
                    <dd>{ticket.order_number}</dd>
                  </div>
                )}
                {ticket.occurred_at > 0 && (
                  <div>
                    <dt className='text-muted-foreground'>
                      {t('Time of occurrence')}
                    </dt>
                    <dd>{formatTimestampToDate(ticket.occurred_at)}</dd>
                  </div>
                )}
                {ticket.model_name && (
                  <div>
                    <dt className='text-muted-foreground'>{t('Model')}</dt>
                    <dd>{ticket.model_name}</dd>
                  </div>
                )}
              </dl>
              {canManage && (
                <div className='space-y-3'>
                  <TicketSelect
                    label={t('Status')}
                    value={ticket.status}
                    options={ticketStatuses}
                    renderOption={(value) => (
                      <TicketStatusBadge status={value as TicketStatus} />
                    )}
                    disabled={update.isPending}
                    onChange={(status) =>
                      update.mutate({ status: status as TicketStatus })
                    }
                  />
                  <Label
                    htmlFor={`ticket-assignee-${props.variant ?? 'dialog'}`}
                  >
                    {t('Assignee ID')}
                  </Label>
                  <Input
                    id={`ticket-assignee-${props.variant ?? 'dialog'}`}
                    type='number'
                    min={0}
                    value={assignee}
                    placeholder={String(ticket.assignee_id)}
                    disabled={update.isPending}
                    onChange={(event) => setAssignee(event.target.value)}
                  />
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={
                      update.isPending ||
                      assignee === '' ||
                      !Number.isInteger(Number(assignee)) ||
                      Number(assignee) < 0
                    }
                    onClick={() =>
                      update.mutate({ assignee: Number(assignee) })
                    }
                  >
                    {t('Assign')}
                  </Button>
                </div>
              )}
              {!props.staff && ticket.status !== 'closed' && (
                <Button
                  variant='outline'
                  disabled={update.isPending}
                  onClick={() => setCloseConfirm(true)}
                >
                  {t('Close ticket')}
                </Button>
              )}
              {!props.staff && ticket.status === 'closed' && (
                <Button
                  variant='outline'
                  disabled={update.isPending}
                  onClick={() => update.mutate({ status: 'pending' })}
                >
                  {t('Reopen ticket')}
                </Button>
              )}
              <div className='space-y-2 border-t pt-3'>
                <p className='font-medium'>{t('Activity')}</p>
                {query.data.events.map((event) => (
                  <p key={event.id} className='text-muted-foreground text-xs'>
                    {event.action === 'assigned'
                      ? `${t('Assigned')} #${event.assignee_id}`
                      : `${t(ticketStatuses[event.from_status])} → ${t(ticketStatuses[event.to_status])}`}
                    <br />
                    {formatTimestampToDate(event.created_at)}
                  </p>
                ))}
              </div>
            </aside>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={closeConfirm}
        onOpenChange={setCloseConfirm}
        title={t('Close ticket')}
        desc={t('Close this ticket? You can reopen it later.')}
        confirmText={t('Close ticket')}
        isLoading={update.isPending}
        handleConfirm={() => update.mutate({ status: 'closed' })}
      />
    </>
  )
}
