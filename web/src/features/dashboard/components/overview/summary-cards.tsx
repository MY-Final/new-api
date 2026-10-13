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
import { ArrowUpRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import {
  dateToUnixTimestamp,
  formatDateTimeObject,
  getRollingDateRange,
} from '@/lib/time'
import { useAuthStore } from '@/stores/auth-store'

import { getUserQuotaDates } from '../../api'
import { buildDashboardAnalytics } from '../../lib/operations'
import { DateRangePresets } from '../date-range-presets'
import { ConsumptionDistributionChart } from '../models/consumption-distribution-chart'
import { LogStatCards } from '../models/log-stat-cards'
import { ModelCharts } from '../models/model-charts'
import {
  PerformanceOverview,
  PerformanceSuccessCard,
} from '../models/performance-overview'
import { PersonalBalanceCard } from '../models/personal-balance-card'

export function SummaryCards() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = Number(user?.role) >= ROLE.ADMIN
  const [range, setRange] = useState(() => getRollingDateRange(7))
  const granularity =
    range.end.getTime() - range.start.getTime() > 2 * 86400000 ? 'day' : 'hour'
  const start = dateToUnixTimestamp(range.start)
  const end = dateToUnixTimestamp(range.end)
  const query = useQuery({
    queryKey: ['dashboard', 'overview', 'usage', isAdmin, user?.id, start, end],
    queryFn: async () =>
      requireServerSuccess(
        await getUserQuotaDates(
          {
            start_timestamp: start,
            end_timestamp: end,
            default_time: granularity,
          },
          isAdmin
        )
      ).data ?? [],
    enabled: Boolean(user),
    staleTime: 30_000,
    retry: false,
  })
  const analytics = useMemo(
    () => buildDashboardAnalytics(query.data ?? [], granularity, range),
    [query.data, granularity, range]
  )

  return (
    <section
      aria-label={t('Usage at a glance')}
      className='flex min-w-0 flex-col gap-4'
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='text-lg font-semibold tracking-tight'>
              {t('Usage at a glance')}
            </h2>
            <Badge variant='outline'>
              {isAdmin ? t('All users') : t('My usage')}
            </Badge>
          </div>
          <p className='text-muted-foreground text-sm'>
            {isAdmin
              ? t('Site-wide usage in the selected period')
              : t('Your usage in the selected period')}
          </p>
        </div>
        <div className='flex max-w-full flex-wrap items-center gap-2'>
          <DateRangePresets range={range} onChange={setRange} />
          <Button
            variant='outline'
            size='sm'
            render={
              <Link to='/dashboard/$section' params={{ section: 'models' }} />
            }
          >
            {t('Usage Statistics')}
            <ArrowUpRight data-icon='inline-end' />
          </Button>
        </div>
      </div>
      <div className='grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4'>
        <LogStatCards
          data={analytics}
          loading={query.isLoading}
          error={query.isError}
          personal={!isAdmin}
        />
        {isAdmin ? <PerformanceSuccessCard /> : <PersonalBalanceCard />}
      </div>
      <p className='text-muted-foreground text-xs leading-relaxed'>
        {formatDateTimeObject(range.start)} — {formatDateTimeObject(range.end)}
        <span className='mx-2' aria-hidden='true'>
          ·
        </span>
        {t('Usage totals are aggregated by hour')}
      </p>
      <div className='grid min-w-0 items-stretch gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]'>
        {query.isError ? (
          <ErrorState
            title={t('Failed to load statistics')}
            onRetry={() => void query.refetch()}
            className='min-h-72 rounded-xl border'
          />
        ) : (
          <ConsumptionDistributionChart
            data={analytics}
            loading={query.isLoading}
            defaultChartType='area'
            timeGranularity={granularity}
          />
        )}
        {isAdmin ? (
          <PerformanceOverview />
        ) : (
          !query.isError && (
            <ModelCharts
              data={analytics.models}
              loading={query.isLoading}
              defaultMetric='quota'
              filters={{
                start_timestamp: range.start,
                end_timestamp: range.end,
              }}
              title={t('My model usage')}
            />
          )
        )}
      </div>
    </section>
  )
}
