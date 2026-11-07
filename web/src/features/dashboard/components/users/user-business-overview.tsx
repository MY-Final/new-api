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
import { Link } from '@tanstack/react-router'
import { Coins, Gift, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { StaticDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useFreeGroupUsage } from '@/features/home/hooks'
import { getQuotaLedgerSummary } from '@/features/ledger/api'
import { UserUsageDialog } from '@/features/users/components/dialogs/user-usage-dialog'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { useTopSpenders } from '../../hooks/use-top-spenders'
import { PanelWrapper } from '../ui/panel-wrapper'
import { StatCard } from '../ui/stat-card'

export function UserBusinessOverview(props: {
  range: { start: Date; end: Date }
  refetchInterval?: number | false
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfigStore((state) => state.config.currency)
  const [metric, setMetric] = useState<'paid' | 'active'>('paid')
  const [selectedUser, setSelectedUser] = useState<{
    id: number
    username: string
  }>()
  const users = useTopSpenders(props.range, props.refetchInterval)
  const startDate = users.data?.server_start_day
  const endDate = users.data?.server_end_day
  const ledger = useQuery({
    queryKey: [
      'dashboard',
      'overview',
      'ledger',
      startDate,
      endDate,
      'paid-users',
    ],
    queryFn: () =>
      getQuotaLedgerSummary(
        {
          page: 1,
          pageSize: 1,
          startDate: startDate ?? '',
          endDate: endDate ?? '',
          username: '',
        },
        true
      ),
    refetchInterval: props.refetchInterval,
    enabled: !!startDate && !!endDate,
    staleTime: 60_000,
    retry: false,
    meta: { errorToast: false },
  })
  const free = useFreeGroupUsage(props.refetchInterval)
  const timeline = useMemo(() => {
    if (!startDate || !endDate) return []
    const paid = new Map(
      ledger.data?.daily_paid_usage?.map((item) => [
        item.date,
        item.paid_quota,
      ]) ?? []
    )
    const active = new Map(
      users.data?.daily_activity?.map((item) => [item.day, item.users]) ?? []
    )
    const days: { day: string; paid: number; active: number }[] = []
    for (
      let day = dayjs(startDate);
      !day.isAfter(dayjs(endDate), 'day');
      day = day.add(1, 'day')
    ) {
      const date = day.format('YYYY-MM-DD')
      days.push({
        day: date,
        paid: paid.get(date) ?? 0,
        active: active.get(date) ?? 0,
      })
    }
    return days
  }, [
    ledger.data?.daily_paid_usage,
    users.data?.daily_activity,
    startDate,
    endDate,
  ])
  const freeValue = free.data?.enabled
    ? `${formatNumber(free.data.used, locale)} / ${formatNumber(free.data.daily_limit, locale)}`
    : t('Unavailable')
  const label = metric === 'paid' ? t('Paid used') : t('Active users')
  const chartLoading =
    metric === 'paid' ? users.loading || ledger.isLoading : users.loading
  const chartError =
    metric === 'paid' ? users.error || ledger.isError : users.error
  const chartAvailable =
    metric === 'paid'
      ? !!ledger.data?.daily_paid_usage
      : !!users.data?.daily_activity

  return (
    <div className='space-y-4'>
      <section
        aria-label={t('Operations Overview')}
        className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'
      >
        <div className='bg-card rounded-xl border p-4'>
          <h3 className='text-sm font-medium'>{t('Credited quota')}</h3>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t(
              'Gross credits by source for selected server calendar days. Refunds are not deducted; amounts are not cash receipts.'
            )}
          </p>
          <div className='mt-3 space-y-2 text-xs'>
            {[
              {
                name: t('Manual credit'),
                section: 'credits',
                paid: ledger.data?.credits?.manual_paid,
                bonus: ledger.data?.credits?.manual_bonus,
              },
              {
                name: t('Redemption code'),
                section: 'redemptions',
                paid: ledger.data?.credits?.redemption_incomplete
                  ? undefined
                  : ledger.data?.credits?.redemption_paid,
                bonus: ledger.data?.credits?.redemption_incomplete
                  ? undefined
                  : ledger.data?.credits?.redemption_bonus,
              },
              {
                name: t('Online top-up'),
                section: 'topups',
                paid: ledger.data?.credits?.online_incomplete
                  ? undefined
                  : ledger.data?.credits?.online_paid,
              },
            ].map((source) => (
              <div
                key={source.section}
                className='flex flex-wrap justify-between gap-x-2'
              >
                <Link
                  to='/finance/$section'
                  params={{ section: source.section }}
                  className='text-primary underline'
                >
                  {source.name}
                </Link>
                <span>
                  {source.paid === undefined
                    ? '—'
                    : `${t('Paid quota')}: ${formatQuota(source.paid)}`}
                  {source.bonus !== undefined &&
                    ` · ${t('Promotional credit')}: ${formatQuota(source.bonus)}`}
                </span>
              </div>
            ))}
          </div>
          {(users.error ||
            ledger.isError ||
            (!users.loading && !ledger.isLoading && !ledger.data?.credits)) && (
            <p className='text-destructive mt-2 text-xs'>
              {t('Failed to load statistics')}
            </p>
          )}
          {ledger.data?.credits?.redemption_incomplete ||
          ledger.data?.credits?.online_incomplete ? (
            <p className='text-muted-foreground mt-2 text-xs'>
              {t(
                'Some historical records lack credit details. Open the source ledger to review them.'
              )}
            </p>
          ) : null}
          {ledger.data?.credits?.redemption_deleted ? (
            <p className='text-muted-foreground mt-2 text-xs'>
              {t(
                'Deleted redemption codes are included in the totals but are hidden in the source ledger.'
              )}
            </p>
          ) : null}
        </div>
        <div className='bg-card rounded-xl border p-4'>
          <StatCard
            title={t('Paid used')}
            value={
              ledger.data ? formatQuota(ledger.data.range_paid_quota) : '—'
            }
            description={t('Selected calendar days · wallet only')}
            icon={Coins}
            loading={users.loading || ledger.isLoading}
            error={users.error || ledger.isError}
            compact
          />
        </div>
        <div className='bg-card rounded-xl border p-4'>
          <StatCard
            title={t('Active users today')}
            value={
              users.data ? formatNumber(users.data.activity.dau, locale) : '—'
            }
            description={t('Today (server time)')}
            icon={Users}
            loading={users.loading}
            error={users.error}
            compact
          />
        </div>
        <div className='bg-card rounded-xl border p-4'>
          <StatCard
            title={t('Free group calls today')}
            value={freeValue}
            description={t('The daily limit resets at midnight Beijing time.')}
            icon={Gift}
            loading={free.isLoading}
            error={free.isError}
            compact
          />
          <Link
            to='/dashboard/$section'
            params={{ section: 'free-group' }}
            className='text-primary text-xs underline'
          >
            {t('Free group usage')}
          </Link>
        </div>
      </section>
      <PanelWrapper
        title={t('Usage trend')}
        description={t(
          'Daily totals use server dates. Paid usage covers full calendar days; activity follows the selected times.'
        )}
        loading={chartLoading}
        className='rounded-xl shadow-none'
        height='h-64'
        headerActions={
          <Tabs
            value={metric}
            onValueChange={(value) => setMetric(value as 'paid' | 'active')}
          >
            <TabsList aria-label={t('Trend metric')}>
              <TabsTrigger value='paid'>{t('Paid used')}</TabsTrigger>
              <TabsTrigger value='active'>{t('Active users')}</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        {chartError || !chartAvailable ? (
          <ErrorState
            title={t('Failed to load statistics')}
            className='min-h-40'
          />
        ) : (
          <ChartContainer
            className='h-64 w-full'
            aria-label={label}
            config={{ [metric]: { label, color: 'var(--chart-1)' } }}
          >
            <AreaChart
              accessibilityLayer
              data={timeline}
              margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey='day'
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                tickMargin={10}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={70}
                tickFormatter={(value: number) =>
                  metric === 'paid'
                    ? formatQuota(value)
                    : formatCompactNumber(value, locale)
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => (
                      <span className='flex flex-1 justify-between gap-4'>
                        <span>{label}</span>
                        <span>
                          {metric === 'paid'
                            ? formatQuota(Number(value))
                            : formatNumber(Number(value), locale)}
                        </span>
                      </span>
                    )}
                  />
                }
              />
              <Area
                dataKey={metric}
                type='linear'
                fill={`var(--color-${metric})`}
                fillOpacity={0.12}
                stroke={`var(--color-${metric})`}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </PanelWrapper>
      <PanelWrapper
        title={t('Paid usage ranking')}
        description={t(
          'Top 10 users · full calendar days · wallet only. Details use the selected times. Historical data depends on ledger availability.'
        )}
        loading={users.loading || ledger.isLoading}
        className='rounded-xl shadow-none'
      >
        {!ledger.data?.paid_users ? (
          <ErrorState
            title={t('Failed to load statistics')}
            className='min-h-40'
          />
        ) : (
          <StaticDataTable
            columns={[
              {
                id: 'username',
                header: t('Username'),
                cell: (row) => (
                  <Button
                    variant='link'
                    className='h-auto p-0'
                    onClick={() =>
                      setSelectedUser({
                        id: row.user_id,
                        username: row.username || `#${row.user_id}`,
                      })
                    }
                  >
                    {row.username || `#${row.user_id}`}
                  </Button>
                ),
              },
              {
                id: 'paid',
                header: t('Paid used'),
                cell: (row) => formatQuota(row.paid_quota),
              },
            ]}
            data={ledger.data.paid_users}
            getRowKey={(row) => row.user_id}
            emptyContent={t('No usage data')}
          />
        )}
      </PanelWrapper>
      {selectedUser && (
        <UserUsageDialog
          key={selectedUser.id}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedUser(undefined)
          }}
          userId={selectedUser.id}
          username={selectedUser.username}
          initialRange={props.range}
        />
      )}
    </div>
  )
}
