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
import type { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStatus } from '@/hooks/use-status'
import { formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { listTickets } from './api'
import { CreateTicketDialog } from './components/create-ticket-dialog'
import { TicketDetailDialog } from './components/ticket-detail-dialog'
import { TicketInbox } from './components/ticket-inbox'
import { TicketSelect } from './components/ticket-select'
import { TicketStatusBadge } from './components/ticket-status-badge'
import { ticketCategories, ticketStatuses } from './constants'
import type { Ticket, TicketStatus } from './types'

export function TicketsPage(props: { staff: boolean }) {
  if (props.staff) return <TicketInbox />
  return <MyTicketsPage />
}

function MyTicketsPage() {
  const { t } = useTranslation()
  const { status: site } = useStatus()
  const user = useAuthStore((state) => state.auth.user)
  const [createOpen, setCreateOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [category, setCategory] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [selected, setSelected] = useState<number | null>(null)
  const query = useQuery({
    queryKey: [
      'tickets',
      'list',
      false,
      user?.id,
      filter,
      category,
      search,
      pagination,
    ],
    queryFn: () =>
      listTickets(false, {
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        status: filter === 'all' ? '' : filter,
        category: category === 'all' ? '' : category,
        keyword: search,
      }),
    refetchInterval: 30000,
  })
  const columns: ColumnDef<Ticket>[] = [
    {
      accessorKey: 'title',
      header: t('Ticket'),
      cell: ({ row }) => (
        <Button
          variant='link'
          className='h-auto max-w-full justify-start p-0 text-left [overflow-wrap:anywhere] whitespace-normal'
          onClick={() => setSelected(row.original.id)}
        >
          #{row.original.id} · {row.original.title}
          {row.original.unread && <Badge>{t('Unread')}</Badge>}
        </Button>
      ),
      meta: { mobileTitle: true },
    },
    {
      accessorKey: 'category',
      header: t('Category'),
      cell: ({ row }) => t(ticketCategories[row.original.category]),
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => <TicketStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'updated_at',
      header: t('Updated at'),
      cell: ({ row }) => formatTimestampToDate(row.original.updated_at),
    },
  ]
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    manualPagination: true,
    manualFiltering: true,
    enableSorting: false,
    totalCount: query.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
  })
  const toolbar = (
    <form
      className='flex flex-wrap items-center gap-2'
      onSubmit={(event) => {
        event.preventDefault()
        setSearch(keyword)
        setPagination((value) => ({ ...value, pageIndex: 0 }))
      }}
    >
      <TicketSelect
        label={t('Status')}
        className='sm:w-44'
        value={filter}
        options={{ all: 'All', ...ticketStatuses }}
        renderOption={(value) =>
          value === 'all' ? (
            t('All')
          ) : (
            <TicketStatusBadge status={value as TicketStatus} />
          )
        }
        onChange={(value) => {
          setFilter(value)
          setPagination((previous) => ({ ...previous, pageIndex: 0 }))
        }}
      />
      <TicketSelect
        label={t('Category')}
        className='sm:w-44'
        value={category}
        options={{ all: 'All', ...ticketCategories }}
        onChange={(value) => {
          setCategory(value)
          setPagination((previous) => ({ ...previous, pageIndex: 0 }))
        }}
      />
      <Input
        className='w-full sm:w-64'
        aria-label={t('Search tickets')}
        placeholder={t('Search tickets')}
        value={keyword}
        maxLength={160}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <Button type='submit' variant='outline'>
        {t('Search')}
      </Button>
    </form>
  )
  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('My tickets')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            disabled={site?.support_tickets_enabled === false}
            onClick={() => setCreateOpen(true)}
          >
            {t('Submit ticket')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          {site?.support_tickets_enabled === false && (
            <p className='text-muted-foreground mb-3 text-sm'>
              {t('Ticket submissions are disabled')}
            </p>
          )}
          {query.isError ? (
            <ErrorState
              onRetry={() => {
                void query.refetch()
              }}
            />
          ) : (
            <DataTablePage
              table={table}
              columns={columns}
              toolbar={toolbar}
              isLoading={query.isPending}
              isFetching={query.isFetching}
              emptyTitle={t('No tickets yet')}
              emptyDescription={t('Submit a ticket when you need help.')}
            />
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {createOpen && (
        <CreateTicketDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false)
            setSelected(id)
          }}
        />
      )}
      {selected !== null && (
        <TicketDetailDialog
          key={selected}
          id={selected}
          staff={false}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
