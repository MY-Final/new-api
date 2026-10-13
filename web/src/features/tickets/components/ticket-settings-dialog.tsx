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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import { useStatus } from '@/hooks/use-status'
import { handleServerError } from '@/lib/handle-server-error'

import { cleanupTickets } from '../api'
import { TicketStorageSettingsPanel } from './ticket-storage-settings'

export function TicketSettingsDialog(props: { onClose: () => void }) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const client = useQueryClient()
  const option = useUpdateOption()
  const [days, setDays] = useState(180)
  const [confirm, setConfirm] = useState(false)
  const [deleted, setDeleted] = useState<number | null>(null)
  const cleanup = useMutation({
    mutationFn: () => cleanupTickets(days),
    onSuccess: (count) => {
      setConfirm(false)
      setDeleted(count)
      void client.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (error) => handleServerError(error, t('Ticket operation failed')),
  })
  return (
    <>
      <Dialog
        open
        title={t('Ticket settings')}
        onOpenChange={(open) => {
          if (!open && !option.isPending && !cleanup.isPending) props.onClose()
        }}
      >
        <div className='space-y-5'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <p>{t('Accept new tickets')}</p>
            <Button
              variant='outline'
              disabled={option.isPending}
              onClick={() =>
                option.mutate({
                  key: 'SupportTicketsEnabled',
                  value:
                    status?.support_tickets_enabled === false
                      ? 'true'
                      : 'false',
                })
              }
            >
              {status?.support_tickets_enabled === false
                ? t('Enable')
                : t('Disable')}
            </Button>
          </div>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Existing tickets remain accessible when submissions are disabled.'
            )}
          </p>
          <TicketStorageSettingsPanel />
          <div className='space-y-2 border-t pt-4'>
            <Label htmlFor='ticket-retention'>
              {t('Delete closed tickets older than (days)')}
            </Label>
            <Input
              id='ticket-retention'
              type='number'
              min={30}
              max={3650}
              value={days}
              disabled={cleanup.isPending}
              onChange={(event) => setDays(Number(event.target.value))}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'Each cleanup deletes up to 100 closed tickets and their screenshots. Repeat to continue.'
              )}
            </p>
            <Button
              variant='destructive'
              disabled={
                !Number.isInteger(days) ||
                days < 30 ||
                days > 3650 ||
                cleanup.isPending
              }
              onClick={() => setConfirm(true)}
            >
              {t('Clean up tickets')}
            </Button>
          </div>
          {deleted !== null && (
            <p role='status'>
              {t('Deleted {{count}} tickets', { count: deleted })}
            </p>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Clean up tickets')}
        desc={t(
          'Permanently delete closed tickets older than {{days}} days, including messages and screenshots?',
          { days }
        )}
        destructive
        isLoading={cleanup.isPending}
        handleConfirm={() => cleanup.mutate()}
      />
    </>
  )
}
