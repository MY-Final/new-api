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
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { getEmailStatistics } from '../api'
import { SettingsSection } from '../components/settings-section'
import { emailPurposeLabel } from './email-purposes'

const EMAIL_STATISTICS_DAYS = 14

type EmailStatisticsSectionProps = {
  // Zero hides that quota comparison, so the page also works for transport
  // plans that have no limit.
  dailyQuota: number
  monthlyQuota: number
}

function quotaPercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(100, (used / limit) * 100)
}

function StatTile(props: {
  label: string
  value: string
  detail: string
  children?: ReactNode
}) {
  return (
    <div className='rounded-lg border p-4'>
      <div className='text-muted-foreground text-sm'>{props.label}</div>
      <div className='text-lg font-semibold'>{props.value}</div>
      <div className='text-muted-foreground text-xs'>{props.detail}</div>
      {props.children}
    </div>
  )
}

export function EmailStatisticsSection(props: EmailStatisticsSectionProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const statisticsQuery = useQuery({
    queryKey: ['email-statistics', EMAIL_STATISTICS_DAYS],
    queryFn: async () =>
      requireServerSuccess(await getEmailStatistics(EMAIL_STATISTICS_DAYS)),
    staleTime: 60 * 1000,
  })
  const statistics = statisticsQuery.data?.data

  const dailyRows = useMemo(() => {
    const totalsByDate = new Map<
      string,
      { delivered: number; failed: number }
    >()
    for (const row of statistics?.daily ?? []) {
      if (!row.date) continue
      const totals = totalsByDate.get(row.date) ?? { delivered: 0, failed: 0 }
      totalsByDate.set(row.date, {
        delivered: totals.delivered + row.delivered,
        failed: totals.failed + row.failed,
      })
    }
    return [...totalsByDate.entries()]
      .map(([date, totals]) => ({ date, ...totals }))
      .sort((left, right) => right.date.localeCompare(left.date))
  }, [statistics?.daily])

  const title = t('Email delivery statistics')

  if (statisticsQuery.isPending) {
    return (
      <SettingsSection title={title}>
        <LoadingState size='sm' />
      </SettingsSection>
    )
  }

  if (statisticsQuery.isError || !statistics) {
    return (
      <SettingsSection title={title}>
        <ErrorState
          title={t('Failed to load email statistics')}
          onRetry={() => void statisticsQuery.refetch()}
        />
      </SettingsSection>
    )
  }

  const showDailyQuota = statistics.resend_in_use && props.dailyQuota > 0
  const showMonthlyQuota = statistics.resend_in_use && props.monthlyQuota > 0
  const cardCount =
    2 + Number(showDailyQuota) + Number(showMonthlyQuota)

  return (
    <SettingsSection title={title}>
      <div
        className={cn(
          'grid gap-4 sm:grid-cols-2',
          cardCount === 3 && 'lg:grid-cols-3',
          cardCount === 4 && 'lg:grid-cols-4'
        )}
      >
        <StatTile
          label={t('Sent today')}
          value={formatNumber(statistics.today.delivered, locale)}
          detail={t('{{count}} failed', {
            count: formatNumber(statistics.today.failed, locale),
          })}
        />
        <StatTile
          label={t('Sent this month')}
          value={formatNumber(statistics.month.delivered, locale)}
          detail={t('{{count}} failed', {
            count: formatNumber(statistics.month.failed, locale),
          })}
        />
        {showDailyQuota && (
          <StatTile
            label={t('Resend daily quota used')}
            value={t('{{used}} / {{limit}}', {
              used: formatNumber(statistics.resend_today.delivered, locale),
              limit: formatNumber(props.dailyQuota, locale),
            })}
            detail={t('{{count}} remaining', {
              count: formatNumber(
                props.dailyQuota - statistics.resend_today.delivered,
                locale
              ),
            })}
          >
            <Progress
              value={quotaPercent(
                statistics.resend_today.delivered,
                props.dailyQuota
              )}
              className='mt-2'
            />
          </StatTile>
        )}
        {showMonthlyQuota && (
          <StatTile
            label={t('Resend monthly quota used')}
            value={t('{{used}} / {{limit}}', {
              used: formatNumber(statistics.resend_month.delivered, locale),
              limit: formatNumber(props.monthlyQuota, locale),
            })}
            detail={t('{{count}} remaining', {
              count: formatNumber(
                props.monthlyQuota - statistics.resend_month.delivered,
                locale
              ),
            })}
          >
            <Progress
              value={quotaPercent(
                statistics.resend_month.delivered,
                props.monthlyQuota
              )}
              className='mt-2'
            />
          </StatTile>
        )}
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <TitledCard
          title={t('By purpose')}
          description={t('Current calendar month')}
        >
          {statistics.purposes.length === 0 ? (
            <p className='text-muted-foreground text-sm'>{t('No data')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Purpose')}</TableHead>
                  <TableHead>{t('Sent via')}</TableHead>
                  <TableHead className='text-right'>{t('Sent')}</TableHead>
                  <TableHead className='text-right'>{t('Failed')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statistics.purposes.map((row) => (
                  <TableRow key={`${row.purpose}-${row.provider}`}>
                    <TableCell>{t(emailPurposeLabel(row.purpose))}</TableCell>
                    <TableCell>
                      <Badge variant='outline'>{row.provider}</Badge>
                    </TableCell>
                    <TableCell className='text-right'>
                      {formatNumber(row.delivered, locale)}
                    </TableCell>
                    <TableCell className='text-right'>
                      {formatNumber(row.failed, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TitledCard>

        <TitledCard
          title={t('Daily volume')}
          description={t('Last {{count}} days', {
            count: EMAIL_STATISTICS_DAYS,
          })}
        >
          {dailyRows.length === 0 ? (
            <p className='text-muted-foreground text-sm'>{t('No data')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Date')}</TableHead>
                  <TableHead className='text-right'>{t('Sent')}</TableHead>
                  <TableHead className='text-right'>{t('Failed')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyRows.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell>{row.date}</TableCell>
                    <TableCell className='text-right'>
                      {formatNumber(row.delivered, locale)}
                    </TableCell>
                    <TableCell className='text-right'>
                      {formatNumber(row.failed, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TitledCard>
      </div>
    </SettingsSection>
  )
}
