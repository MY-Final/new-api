/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { getAffiliateInvitees } from '../../api'
import type { AffiliateInvitee } from '../../types'

interface AffiliateInviteesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const pageSize = 10
const skeletonKeys = ['one', 'two', 'three', 'four']

function InviteeList({
  loading,
  invitees,
}: {
  loading: boolean
  invitees: AffiliateInvitee[]
}) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className='space-y-2'>
        {skeletonKeys.map((key) => (
          <Skeleton key={key} className='h-12 rounded-lg' />
        ))}
      </div>
    )
  }

  if (invitees.length === 0) {
    return (
      <div className='text-muted-foreground flex min-h-40 items-center justify-center text-sm'>
        {t('No invited users yet')}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('Email')}</TableHead>
          <TableHead>{t('Username')}</TableHead>
          <TableHead className='text-right'>{t('Rebate earned')}</TableHead>
          <TableHead>{t('Registered')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitees.map((invitee) => (
          <TableRow key={invitee.id}>
            <TableCell className='max-w-44 truncate font-mono text-xs'>
              {invitee.email || '-'}
            </TableCell>
            <TableCell className='max-w-36 truncate'>
              {invitee.username || '-'}
            </TableCell>
            <TableCell className='text-right'>
              <div className='text-success font-medium'>
                {formatQuota(invitee.rebate_quota)}
              </div>
              {invitee.reversed_quota > 0 ? (
                <div className='text-muted-foreground text-xs'>
                  {t('Reversed')}: {formatQuota(invitee.reversed_quota)}
                </div>
              ) : null}
            </TableCell>
            <TableCell className='text-muted-foreground text-xs'>
              {formatTimestampToDate(invitee.created_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function AffiliateInviteesDialog({
  open,
  onOpenChange,
}: AffiliateInviteesDialogProps) {
  const { t } = useTranslation()
  const [invitees, setInvitees] = useState<AffiliateInvitee[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    void getAffiliateInvitees(page, pageSize)
      .then((response) => {
        if (cancelled) return
        setInvitees(response.data?.items ?? [])
        setTotal(response.data?.total ?? 0)
      })
      .catch((error: unknown) => {
        if (!cancelled) handleServerError(error)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, page])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Invite Details')}
      description={t(
        'View the users who joined through your referral link and the rewards they generated.'
      )}
      contentClassName='max-h-[calc(100dvh-2rem)] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-3xl'
      bodyClassName='space-y-3'
    >
      <InviteeList loading={loading} invitees={invitees} />
      {!loading && total > 0 ? (
        <div className='flex items-center justify-between border-t pt-3'>
          <span className='text-muted-foreground text-xs'>
            {t('Page {{page}} of {{totalPages}}', { page, totalPages })}
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='size-8 p-0'
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              aria-label={t('Previous page')}
            >
              <ChevronLeft className='size-4' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='size-8 p-0'
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
              disabled={page >= totalPages}
              aria-label={t('Next page')}
            >
              <ChevronRight className='size-4' />
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}
