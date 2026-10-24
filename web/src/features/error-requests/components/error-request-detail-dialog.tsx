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
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import dayjs from '@/lib/dayjs'

import { getRequestErrorLog } from '../api'

export function ErrorRequestDetailDialog(props: {
  id: number | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const open = props.id !== null
  const query = useQuery({
    queryKey: ['error-request-detail', props.id],
    queryFn: () => getRequestErrorLog(props.id as number),
    enabled: open,
    retry: false,
  })
  const entry = query.data
  const body = useMemo(() => {
    if (!entry?.body) return ''
    try {
      return JSON.stringify(JSON.parse(entry.body), null, 2)
    } catch {
      return entry.body
    }
  }, [entry?.body])

  return (
    <Dialog
      open={open}
      onOpenChange={props.onOpenChange}
      title={t('Error request details')}
      description={entry?.request_id}
      contentClassName='sm:max-w-3xl'
      bodyClassName='space-y-4'
      footer={
        entry?.body ? (
          <CopyButton value={entry.body} variant='outline' size='sm'>
            {t('Copy request body')}
          </CopyButton>
        ) : null
      }
    >
      {query.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Failed to load error request')}
          </AlertDescription>
        </Alert>
      )}
      {entry && (
        <>
          <dl className='grid grid-cols-1 gap-3 text-sm sm:grid-cols-2'>
            <DetailItem label={t('Time')}>
              {dayjs.unix(entry.created_at).format('YYYY-MM-DD HH:mm:ss')}
            </DetailItem>
            <DetailItem label={t('User')}>
              {entry.username
                ? `${entry.username} (#${entry.user_id})`
                : `#${entry.user_id}`}
            </DetailItem>
            <DetailItem label={t('Token')}>
              {entry.token_name || '—'}
            </DetailItem>
            <DetailItem label={t('Model')}>
              {entry.model_name || '—'}
            </DetailItem>
            <DetailItem label={t('Channel')}>
              {entry.channel_id || '—'}
            </DetailItem>
            <DetailItem label={t('Group')}>{entry.group || '—'}</DetailItem>
            <DetailItem label={t('Status')}>{entry.status_code}</DetailItem>
            <DetailItem label={t('Request path')}>
              {entry.request_path || '—'}
            </DetailItem>
            <DetailItem label={t('Error code')}>
              {entry.error_code || '—'}
            </DetailItem>
            <DetailItem label={t('IP')}>{entry.ip || '—'}</DetailItem>
            <DetailItem label={t('Stream')}>
              {entry.is_stream ? t('Yes') : t('No')}
            </DetailItem>
            <DetailItem
              label={t('Duration')}
            >{`${entry.use_time}s`}</DetailItem>
          </dl>

          <section className='space-y-1'>
            <h4 className='text-sm font-medium'>{t('Error message')}</h4>
            <pre className='bg-muted/40 max-h-48 overflow-auto rounded-md border p-3 text-xs break-words whitespace-pre-wrap'>
              {entry.error_message || '—'}
            </pre>
          </section>

          <section className='space-y-1'>
            <div className='flex items-center justify-between gap-2'>
              <h4 className='text-sm font-medium'>{t('Request body')}</h4>
              {entry.body_truncated && (
                <span className='text-muted-foreground text-xs'>
                  {t('Truncated at the configured size limit')}
                </span>
              )}
            </div>
            {body ? (
              <pre className='bg-muted/40 max-h-96 overflow-auto rounded-md border p-3 text-xs break-words whitespace-pre-wrap'>
                {body}
              </pre>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {t('The request body was not captured')}
              </p>
            )}
          </section>
        </>
      )}
    </Dialog>
  )
}

function DetailItem(props: { label: string; children: ReactNode }) {
  return (
    <div className='min-w-0'>
      <dt className='text-muted-foreground text-xs'>{props.label}</dt>
      <dd
        className='truncate font-mono text-xs'
        title={String(props.children ?? '')}
      >
        {props.children}
      </dd>
    </div>
  )
}
