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
import {
  AlertTriangle,
  Ticket,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { getQuotaLedgerSummary } from '@/features/ledger/api'
import { getTicketStats } from '@/features/tickets/api'
import { toIntlLocale } from '@/i18n/languages'
import { hasPermission } from '@/lib/admin-permissions'
import dayjs from '@/lib/dayjs'
import { formatNumber, formatQuota } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { useTopSpenders } from '../../hooks/use-top-spenders'

interface OperationsStripProps {
  range: { start: Date; end: Date }
}

interface OperationsMetric {
  key: string
  label: string
  value: string
  icon: LucideIcon
  tone: IconBadgeTone
}

export function OperationsStrip(props: OperationsStripProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  // Subscribe so quota amounts re-render when the display currency changes.
  useSystemConfigStore((state) => state.config.currency)
  const user = useAuthStore((state) => state.auth.user)
  const canReadTickets = hasPermission(user, 'ticket', 'read')
  const startDate = dayjs(props.range.start).format('YYYY-MM-DD')
  const endDate = dayjs(props.range.end).format('YYYY-MM-DD')

  const ledgerQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'ledger', startDate, endDate],
    queryFn: () =>
      getQuotaLedgerSummary({
        page: 1,
        pageSize: 1,
        startDate,
        endDate,
        username: '',
      }),
    staleTime: 60_000,
    retry: false,
    meta: { errorToast: false },
  })
  // Shares the spending-ranking request: its response also carries today's
  // site-wide activity counters.
  const spenderQuery = useTopSpenders(props.range)
  const ticketQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'ticket-stats'],
    queryFn: () => getTicketStats(true),
    enabled: canReadTickets,
    staleTime: 60_000,
    retry: false,
    meta: { errorToast: false },
  })

  const metricValue = (loading: boolean, error: boolean, value: string) =>
    loading || error ? '—' : value

  const metrics: OperationsMetric[] = [
    {
      key: 'topup',
      label: t('Paid used'),
      value: metricValue(
        ledgerQuery.isLoading,
        ledgerQuery.isError,
        formatQuota(ledgerQuery.data?.range_paid_quota ?? 0)
      ),
      icon: Wallet,
      tone: 'chart-1',
    },
    {
      key: 'active',
      label: t('Active users'),
      value: metricValue(
        spenderQuery.loading,
        spenderQuery.error,
        formatNumber(spenderQuery.data?.activity.dau ?? 0, locale)
      ),
      icon: Users,
      tone: 'chart-2',
    },
    {
      key: 'debt',
      label: t('Debt users'),
      value: metricValue(
        ledgerQuery.isLoading,
        ledgerQuery.isError,
        formatNumber(ledgerQuery.data?.debt_users ?? 0, locale)
      ),
      icon: AlertTriangle,
      tone: 'warning',
    },
    ...(canReadTickets
      ? [
          {
            key: 'tickets',
            label: t('Pending tickets'),
            value: metricValue(
              ticketQuery.isLoading,
              ticketQuery.isError,
              formatNumber(ticketQuery.data?.pending ?? 0, locale)
            ),
            icon: Ticket,
            tone: 'info' as const,
          },
        ]
      : []),
  ]

  return (
    <section
      aria-label={t('Operations Overview')}
      className='bg-card divide-border grid min-w-0 grid-cols-1 divide-y overflow-hidden rounded-xl border sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-y-0'
    >
      {metrics.map((metric) => {
        const Icon = metric.icon

        return (
          <div
            key={metric.key}
            className='flex min-w-0 items-center gap-3 px-4 py-3'
          >
            <IconBadge tone={metric.tone} size='sm'>
              <Icon />
            </IconBadge>
            <div className='min-w-0'>
              <div className='text-muted-foreground truncate text-[11px] font-medium'>
                {metric.label}
              </div>
              <div className='font-mono text-base font-semibold tabular-nums'>
                {metric.value}
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}
