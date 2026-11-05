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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { formatQuota } from '@/lib/format'

import type { SubscriptionUsageRecord } from '../types'

interface SubscriptionUsageRecordCardProps {
  record: SubscriptionUsageRecord
  locale?: string
}

export function SubscriptionUsageRecordCard(
  props: SubscriptionUsageRecordCardProps
) {
  const { t } = useTranslation()
  const record = props.record
  const planLabel = record.plan_title || t('Subscription')
  const tokenLabel =
    record.token_name || (record.token_id > 0 ? `#${record.token_id}` : '')
  const channelLabel =
    record.channel_name ||
    (record.channel_id > 0 ? `#${record.channel_id}` : '')

  return (
    <div className='rounded-lg border p-3 sm:p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 space-y-1'>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <span className='truncate text-sm font-medium'>
              {record.model_name || '-'}
            </span>
            {record.refunded_quota > 0 && (
              <StatusBadge
                label={t('Refunded')}
                variant='neutral'
                size='sm'
                copyable={false}
              />
            )}
          </div>
          <div className='text-muted-foreground text-xs'>
            {planLabel} · {t('Subscription')} #{record.subscription_id}
          </div>
        </div>
        <div className='shrink-0 text-right'>
          <div className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
            {t('Consumed Quota')}
          </div>
          <div className='mt-1 font-mono text-sm font-semibold tabular-nums sm:text-base'>
            {formatQuota(record.quota)}
          </div>
          {record.refunded_quota > 0 && (
            <div className='text-muted-foreground mt-1 text-[11px]'>
              {t('Refunded quota')}: {formatQuota(record.refunded_quota)}
            </div>
          )}
        </div>
      </div>
      <div className='text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
        <span>
          {new Date(record.created_at * 1000).toLocaleString(props.locale)}
        </span>
        {tokenLabel && (
          <span className='truncate'>
            {t('Token')}: {tokenLabel}
          </span>
        )}
        {channelLabel && (
          <span className='truncate'>
            {t('Channel')}: {channelLabel}
          </span>
        )}
        <span className='flex min-w-0 items-center gap-1'>
          <span>{t('Request ID')}:</span>
          <code className='text-foreground max-w-52 truncate font-mono'>
            {record.request_id}
          </code>
          <CopyButton
            value={record.request_id}
            size='sm'
            className='h-5 w-5 p-0'
            iconClassName='h-3 w-3'
          />
        </span>
      </div>
    </div>
  )
}
