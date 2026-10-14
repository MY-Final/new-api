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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatTimestampToDate } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { getTicketStats, listTickets } from '../api'
import { ticketCategories, ticketStatuses } from '../constants'
import type { Ticket, TicketStatus } from '../types'
import { TicketDetailPanel } from './ticket-detail-panel'
import { TicketSelect } from './ticket-select'
import { TicketSettingsDialog } from './ticket-settings-dialog'
import { TicketStatusBadge } from './ticket-status-badge'

const INBOX_PAGE_SIZE = 30
const STATUS_FOLDERS = [
  'pending',
  'processing',
  'waiting',
  'resolved',
  'closed',
] as const

function isStatusFolder(value: string): value is TicketStatus {
  return (STATUS_FOLDERS as readonly string[]).includes(value)
}

function previewLabel(
  senderType: Ticket['preview_sender_type'],
  t: (key: string) => string
) {
  if (senderType === 'note') return t('Internal note')
  if (senderType === 'admin') return t('Support')
  return t('User')
}

export function TicketInbox() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isRoot = user?.role === ROLE.SUPER_ADMIN
  const [folder, setFolder] = useState<string>('pending')
  const [category, setCategory] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const statsQuery = useQuery({
    queryKey: ['tickets', 'stats', user?.id],
    queryFn: () => getTicketStats(true),
    refetchInterval: 30000,
  })
  const listQuery = useQuery({
    queryKey: ['tickets', 'inbox', user?.id, folder, category, search, page],
    queryFn: () =>
      listTickets(true, {
        p: page,
        page_size: INBOX_PAGE_SIZE,
        status: isStatusFolder(folder) ? folder : '',
        category: category === 'all' ? '' : category,
        keyword: search,
        ...(folder === 'unread' ? { unread: 'true' } : {}),
      }),
    refetchInterval: 30000,
  })
  const items = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE))
  const filtered = folder !== 'all' || category !== 'all' || search !== ''
  const folders = [
    { value: 'all', label: t('All'), count: statsQuery.data?.all },
    { value: 'unread', label: t('Unread'), count: statsQuery.data?.unread },
    ...STATUS_FOLDERS.map((value) => ({
      value,
      label: t(ticketStatuses[value]),
      count: statsQuery.data?.[value],
      status: value as TicketStatus,
    })),
  ]
  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Ticket Management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          {isRoot && (
            <Button variant='outline' onClick={() => setSettingsOpen(true)}>
              {t('Ticket settings')}
            </Button>
          )}
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col gap-3 lg:grid lg:grid-cols-[190px_minmax(0,1fr)_minmax(0,1.15fr)]'>
            <aside
              className={cn(
                'flex min-w-0 flex-col gap-1',
                selected !== null && 'max-lg:hidden'
              )}
              aria-label={t('Status')}
            >
              {folders.map((item) => {
                const active = folder === item.value
                return (
                  <button
                    key={item.value}
                    type='button'
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      active
                        ? 'bg-muted font-medium'
                        : 'hover:bg-muted/60 text-muted-foreground'
                    )}
                    onClick={() => {
                      setFolder(item.value)
                      setPage(1)
                    }}
                  >
                    {'status' in item && item.status ? (
                      <TicketStatusBadge status={item.status} />
                    ) : (
                      <span className='min-w-0 truncate'>{item.label}</span>
                    )}
                    {item.count !== undefined && (
                      <Badge variant='secondary' className='tabular-nums'>
                        {item.count}
                      </Badge>
                    )}
                  </button>
                )
              })}
            </aside>
            <div
              className={cn(
                'flex min-h-0 min-w-0 flex-col gap-3',
                selected !== null && 'max-lg:hidden'
              )}
            >
              <form
                className='flex flex-col gap-2'
                onSubmit={(event) => {
                  event.preventDefault()
                  setSearch(keyword)
                  setPage(1)
                }}
              >
                <Input
                  aria-label={t('Search tickets')}
                  placeholder={t('Search tickets')}
                  value={keyword}
                  maxLength={160}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <div className='flex gap-2'>
                  <TicketSelect
                    label={t('Category')}
                    className='flex-1'
                    value={category}
                    options={{ all: 'All', ...ticketCategories }}
                    onChange={(value) => {
                      setCategory(value)
                      setPage(1)
                    }}
                  />
                  <Button type='submit' variant='outline' size='sm'>
                    {t('Search')}
                  </Button>
                </div>
              </form>
              <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1'>
                {listQuery.isPending && <LoadingState size='sm' />}
                {listQuery.isError && (
                  <ErrorState
                    onRetry={() => {
                      void listQuery.refetch()
                    }}
                  />
                )}
                {!listQuery.isPending &&
                  !listQuery.isError &&
                  items.length === 0 && (
                    <p className='text-muted-foreground p-4 text-center text-sm'>
                      {t(
                        filtered
                          ? 'No tickets match this filter.'
                          : 'No tickets yet'
                      )}
                    </p>
                  )}
                {items.map((ticket) => (
                  <button
                    key={ticket.id}
                    type='button'
                    aria-current={selected === ticket.id ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      selected === ticket.id
                        ? 'border-primary bg-muted/40'
                        : 'hover:bg-muted/40'
                    )}
                    onClick={() => setSelected(ticket.id)}
                  >
                    <div className='flex min-w-0 items-center gap-2'>
                      <span className='min-w-0 flex-1 truncate font-medium'>
                        #{ticket.id} · {ticket.title}
                      </span>
                      {ticket.unread && <Badge>{t('Unread')}</Badge>}
                    </div>
                    <div className='text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
                      <TicketStatusBadge status={ticket.status} />
                      <span>{t(ticketCategories[ticket.category])}</span>
                      {ticket.user_name && (
                        <span>
                          {ticket.user_name} (#{ticket.user_id})
                        </span>
                      )}
                      <span>{formatTimestampToDate(ticket.updated_at)}</span>
                    </div>
                    {ticket.preview && (
                      <p className='text-muted-foreground mt-1 line-clamp-2 text-xs'>
                        <span className='text-foreground/70'>
                          {previewLabel(ticket.preview_sender_type, t)}:
                        </span>{' '}
                        {ticket.preview}
                      </p>
                    )}
                  </button>
                ))}
              </div>
              <div className='flex items-center justify-between gap-2 text-xs'>
                <span className='text-muted-foreground'>
                  {t('Total')}: {total}
                </span>
                <div className='flex items-center gap-1'>
                  <Button
                    type='button'
                    variant='outline'
                    size='icon-sm'
                    aria-label={t('Previous')}
                    disabled={page <= 1 || listQuery.isFetching}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                  >
                    <ChevronLeft />
                  </Button>
                  <span className='text-muted-foreground tabular-nums'>
                    {page} / {pageCount}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    size='icon-sm'
                    aria-label={t('Next')}
                    disabled={page >= pageCount || listQuery.isFetching}
                    onClick={() =>
                      setPage((current) => Math.min(pageCount, current + 1))
                    }
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            </div>
            <div
              className={cn(
                'min-h-0 min-w-0',
                selected === null && 'max-lg:hidden'
              )}
            >
              {selected === null ? (
                <div className='text-muted-foreground flex h-full min-h-48 items-center justify-center rounded-lg border p-6 text-center text-sm'>
                  {t('Select a ticket to view the conversation.')}
                </div>
              ) : (
                <div className='h-full min-h-0 overflow-y-auto pr-1'>
                  <TicketDetailPanel
                    key={selected}
                    id={selected}
                    staff
                    variant='pane'
                    onBack={() => setSelected(null)}
                  />
                </div>
              )}
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {settingsOpen && (
        <TicketSettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
    </>
  )
}
