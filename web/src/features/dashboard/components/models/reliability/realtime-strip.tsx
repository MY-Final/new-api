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
import { Activity, AlertTriangle, Coins, Hash, Users, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { REALTIME_WINDOW_OPTIONS } from '@/features/dashboard/constants'
import type { LogAnalysisRealtime } from '@/features/dashboard/types'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

interface RealtimeStripProps {
  realtime: LogAnalysisRealtime
  loading: boolean
  windowMinutes: number
  onWindowMinutesChange: (minutes: number) => void
}

export function RealtimeStrip(props: RealtimeStripProps) {
  const { t } = useTranslation()
  const realtime = props.realtime
  const requests = realtime.consume_count + realtime.error_count
  const errorRate = requests > 0 ? realtime.error_count / requests : 0

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex flex-wrap items-center gap-x-5 gap-y-2.5 px-4 py-2.5 sm:px-5 sm:py-3'>
        <div className='flex items-center gap-1.5'>
          <IconBadge tone='info' size='xs'>
            <Activity />
          </IconBadge>
          <span className='text-xs font-semibold whitespace-nowrap'>
            {t('Realtime')}
          </span>
        </div>

        <Select
          items={REALTIME_WINDOW_OPTIONS.map((option) => ({
            value: String(option.value),
            label: t(option.label),
          }))}
          value={String(props.windowMinutes)}
          onValueChange={(value) => props.onWindowMinutesChange(Number(value))}
        >
          <SelectTrigger
            size='sm'
            className='h-7 w-28 text-xs'
            aria-label={t('Realtime window')}
          >
            <SelectValue placeholder={t('Realtime window')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {REALTIME_WINDOW_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={String(option.value)}>
                {t(option.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className='bg-border hidden h-4 w-px sm:block' />

        {props.loading ? (
          <div className='flex flex-wrap items-center gap-x-5 gap-y-2'>
            {['requests', 'errors', 'users', 'tpm', 'quota'].map((key) => (
              <div key={key} className='flex items-center gap-1.5'>
                <Skeleton className='h-3 w-12' />
                <Skeleton className='h-4 w-14' />
              </div>
            ))}
          </div>
        ) : (
          <div className='flex flex-wrap items-center gap-x-5 gap-y-2'>
            <RealtimeMetric
              icon={Hash}
              tone='chart-2'
              label={t('Requests')}
              value={formatNumber(requests)}
            />
            <RealtimeMetric
              icon={AlertTriangle}
              tone={errorRate > 0 ? 'warning' : 'success'}
              label={t('Error rate')}
              value={requests > 0 ? `${(errorRate * 100).toFixed(1)}%` : '—'}
              valueClassName={cn(
                requests > 0 && errorRate > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              )}
            />
            <RealtimeMetric
              icon={Users}
              tone='chart-4'
              label={t('Active users')}
              value={formatNumber(realtime.active_users)}
            />
            <RealtimeMetric
              icon={Activity}
              tone='info'
              label={t('RPM')}
              value={realtime.rpm.toFixed(1)}
            />
            <RealtimeMetric
              icon={Zap}
              tone='chart-5'
              label={t('TPM')}
              value={formatCompactNumber(Math.round(realtime.tpm))}
            />
            <RealtimeMetric
              icon={Coins}
              tone='success'
              label={t('Quota')}
              value={formatQuota(realtime.quota)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function RealtimeMetric(props: {
  icon: React.ComponentType<{ className?: string }>
  tone: IconBadgeTone
  label: string
  value: string
  valueClassName?: string
}) {
  const Icon = props.icon

  return (
    <div className='flex items-center gap-1.5'>
      <IconBadge tone={props.tone} size='xs'>
        <Icon />
      </IconBadge>
      <span className='text-muted-foreground text-[11px]'>{props.label}</span>
      <span
        className={cn(
          'font-mono text-xs font-semibold tabular-nums',
          props.valueClassName
        )}
      >
        {props.value}
      </span>
    </div>
  )
}
