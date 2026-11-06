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
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Button } from '@/components/ui/button'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatTimestampToDate } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getInviteCodeClaims } from '../api'
import type { InviteCode } from '../types'

const CLAIMS_PAGE_SIZE = 20

type InviteCodeClaimsDialogProps = {
  code: InviteCode | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InviteCodeClaimsDialog(props: InviteCodeClaimsDialogProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [props.code?.id, props.open])

  const claimsQuery = useQuery({
    queryKey: [
      'invite-codes',
      'claims',
      props.code?.id,
      page,
      CLAIMS_PAGE_SIZE,
    ],
    queryFn: async () => {
      if (!props.code) return { items: [], total: 0 }
      const response = requireServerSuccess(
        await getInviteCodeClaims(props.code.id, page, CLAIMS_PAGE_SIZE)
      )
      return response.data ?? { items: [], total: 0 }
    },
    enabled: props.open && Boolean(props.code),
    retry: false,
    placeholderData: (previousData) => previousData,
    meta: { errorToast: false },
  })

  const claims = claimsQuery.data?.items ?? []
  const total = claimsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / CLAIMS_PAGE_SIZE))

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Registrations for {{name}}', {
        name: props.code?.name ?? '',
      })}
      description={t(
        'Accounts created with this invitation code and the benefits they received.'
      )}
      contentClassName='sm:max-w-5xl'
      contentHeight='min(65vh, 620px)'
      footer={
        <>
          <span className='text-muted-foreground mr-auto text-sm'>
            {t('{{count}} registrations', { count: total })}
          </span>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={page <= 1 || claimsQuery.isFetching}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft />
            {t('Previous')}
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={page >= totalPages || claimsQuery.isFetching}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            {t('Next')}
            <ChevronRight />
          </Button>
        </>
      }
    >
      {claimsQuery.isError && (
        <p className='text-destructive py-8 text-center text-sm'>
          {t('Failed to load registrations.')}
        </p>
      )}
      {claimsQuery.isLoading && (
        <div className='text-muted-foreground flex h-48 items-center justify-center gap-2 text-sm'>
          <Loader2 className='size-4 animate-spin' />
          {t('Loading...')}
        </div>
      )}
      {!claimsQuery.isLoading && !claimsQuery.isError && (
        <StaticDataTable
          columns={[
            {
              id: 'user',
              header: t('User'),
              cell: (claim) => (
                <div className='min-w-[150px]'>
                  <div className='font-medium'>
                    {claim.display_name || claim.username}
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    @{claim.username}
                  </div>
                </div>
              ),
            },
            {
              id: 'id',
              header: t('ID'),
              cell: (claim) => <TableId value={claim.user_id} />,
            },
            {
              id: 'email',
              header: t('Email'),
              cell: (claim) => claim.email || '-',
            },
            {
              id: 'group',
              header: t('Group'),
              cell: (claim) => (
                <StatusBadge
                  label={claim.group}
                  variant='info'
                  copyable={false}
                />
              ),
            },
            {
              id: 'bonus',
              header: t('Bonus'),
              cell: (claim) =>
                formatQuotaWithCurrency(claim.bonus_quota, {
                  abbreviate: false,
                }),
            },
            {
              id: 'inviter',
              header: t('Inviter'),
              cell: (claim) =>
                claim.inviter_id > 0 ? (
                  <TableId value={claim.inviter_id} />
                ) : (
                  '-'
                ),
            },
            {
              id: 'claimed_at',
              header: t('Registered'),
              cell: (claim) => formatTimestampToDate(claim.claimed_at),
            },
          ]}
          data={claims}
          getRowKey={(claim) => claim.user_id}
          emptyContent={t('No registrations yet.')}
        />
      )}
    </Dialog>
  )
}
