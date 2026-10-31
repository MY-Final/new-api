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
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Eye, EyeOff } from 'lucide-react'
import { useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { FadeIn } from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { AutoRefreshControl } from '@/features/usage-logs/components/auto-refresh-control'
import {
  DASHBOARD_AUTO_REFRESH_STORAGE_KEY,
  useAutoRefreshInterval,
} from '@/hooks'
import { ROLE } from '@/lib/roles'
import { getRollingDateRange } from '@/lib/time'
import { useAuthStore } from '@/stores/auth-store'

import { ModelsChartPreferences } from './components/models/models-chart-preferences'
import { ModelsFilter } from './components/models/models-filter-dialog'
import { OperationsStrip } from './components/overview/operations-strip'
import { OverviewDashboard } from './components/overview/overview-dashboard'
import {
  buildDefaultDashboardFilters,
  buildDefaultUserChartsFilters,
  getSavedChartPreferences,
  saveChartPreferences,
} from './lib'
import {
  type DashboardSectionId,
  DASHBOARD_DEFAULT_SECTION,
  DASHBOARD_SECTION_IDS,
} from './section-registry'
import type {
  DashboardChartPreferences,
  DashboardFilters,
  UserChartsFilters,
} from './types'

const route = getRouteApi('/_authenticated/dashboard/$section')

const LazyModelDashboard = lazy(() =>
  import('./components/models/model-dashboard').then((m) => ({
    default: m.ModelDashboard,
  }))
)

const LazyUserCharts = lazy(() =>
  import('./components/users/user-charts').then((m) => ({
    default: m.UserCharts,
  }))
)

const LazyFlowCharts = lazy(() =>
  import('./components/flow/flow-charts').then((m) => ({
    default: m.FlowCharts,
  }))
)

function ModelChartsFallback() {
  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex items-center justify-between border-b px-4 py-3 sm:px-5'>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-8 w-72' />
      </div>
      <div className='h-96 p-2'>
        <Skeleton className='h-full w-full' />
      </div>
    </div>
  )
}

const SECTION_META: Record<DashboardSectionId, { titleKey: string }> = {
  overview: {
    titleKey: 'Overview',
  },
  models: {
    titleKey: 'Operations Overview',
  },
  flow: {
    titleKey: 'Flow',
  },
  users: {
    titleKey: 'Users & Revenue',
  },
}

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const params = route.useParams()
  const userRole = useAuthStore((state) => state.auth.user?.role)
  const activeSection = (params.section ??
    DASHBOARD_DEFAULT_SECTION) as DashboardSectionId

  const [chartPreferences, setChartPreferences] =
    useState<DashboardChartPreferences>(() => getSavedChartPreferences())
  const [modelFilters, setModelFilters] = useState<DashboardFilters>(() =>
    buildDefaultDashboardFilters(getSavedChartPreferences())
  )
  // The user analytics view shares the model/flow period: one range selects the
  // same window for every dashboard tab instead of each tab remembering its own.
  const [userChartOptions, setUserChartOptions] = useState(() => {
    const defaults = buildDefaultUserChartsFilters()
    return {
      timeGranularity: defaults.timeGranularity,
      topUserLimit: defaults.topUserLimit,
    }
  })
  const [flowSensitiveVisible, setFlowSensitiveVisible] = useState(true)
  const { autoRefreshInterval, setAutoRefreshInterval } =
    useAutoRefreshInterval(DASHBOARD_AUTO_REFRESH_STORAGE_KEY)
  const refetchInterval =
    autoRefreshInterval > 0 ? autoRefreshInterval : (false as const)

  const handleFilterChange = useCallback((filters: DashboardFilters) => {
    setModelFilters(filters)
  }, [])

  const handleResetFilters = useCallback(() => {
    setModelFilters(buildDefaultDashboardFilters(chartPreferences))
  }, [chartPreferences])

  const handleUserFiltersChange = useCallback((filters: UserChartsFilters) => {
    setUserChartOptions({
      timeGranularity: filters.timeGranularity,
      topUserLimit: filters.topUserLimit,
    })
    setModelFilters((previous) => ({
      ...previous,
      start_timestamp: filters.range.start,
      end_timestamp: filters.range.end,
    }))
  }, [])

  const handleChartPreferencesChange = useCallback(
    (preferences: DashboardChartPreferences) => {
      setChartPreferences(preferences)
      setModelFilters(buildDefaultDashboardFilters(preferences))
      saveChartPreferences(preferences)
    },
    []
  )

  const sharedRange = useMemo(() => {
    const fallback = getRollingDateRange(chartPreferences.defaultTimeRangeDays)
    return {
      start: modelFilters.start_timestamp ?? fallback.start,
      end: modelFilters.end_timestamp ?? fallback.end,
    }
  }, [
    chartPreferences.defaultTimeRangeDays,
    modelFilters.end_timestamp,
    modelFilters.start_timestamp,
  ])
  const userChartsFilters = useMemo<UserChartsFilters>(
    () => ({ ...userChartOptions, range: sharedRange }),
    [sharedRange, userChartOptions]
  )

  const meta = SECTION_META[activeSection] ?? SECTION_META.overview
  const isAdmin = Boolean(userRole && userRole >= ROLE.ADMIN)
  const visibleSections = useMemo(
    () =>
      DASHBOARD_SECTION_IDS.filter(
        (section) => section !== 'overview' && (section !== 'users' || isAdmin)
      ),
    [isAdmin]
  )
  const handleSectionChange = useCallback(
    (section: string) => {
      void navigate({
        to: '/dashboard/$section',
        params: { section: section as DashboardSectionId },
      })
    },
    [navigate]
  )
  const showSectionTabs =
    activeSection !== 'overview' && visibleSections.length > 1
  // The tab strip already names the active section, so the page heading
  // stays at the dashboard level instead of repeating the tab label.
  let pageTitle = t(meta.titleKey)
  if (activeSection === 'models' && !isAdmin) pageTitle = t('Usage Analytics')
  if (showSectionTabs) pageTitle = t('Dashboard')
  const modelActions =
    activeSection === 'models' ? (
      <>
        <ModelsChartPreferences
          preferences={chartPreferences}
          onPreferencesChange={handleChartPreferencesChange}
        />
        <ModelsFilter
          preferences={chartPreferences}
          currentFilters={modelFilters}
          onFilterChange={handleFilterChange}
          onReset={handleResetFilters}
          maxRangeDays={isAdmin ? undefined : 30}
        />
        <AutoRefreshControl
          autoRefreshInterval={autoRefreshInterval}
          onAutoRefreshIntervalChange={setAutoRefreshInterval}
        />
      </>
    ) : null
  const userActions =
    activeSection === 'users' ? (
      <AutoRefreshControl
        autoRefreshInterval={autoRefreshInterval}
        onAutoRefreshIntervalChange={setAutoRefreshInterval}
      />
    ) : null
  const flowActions =
    activeSection === 'flow' ? (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='icon'
                onClick={() => setFlowSensitiveVisible((prev) => !prev)}
                aria-label={
                  flowSensitiveVisible
                    ? t('Hide sensitive data')
                    : t('Show sensitive data')
                }
                className='text-muted-foreground hover:text-foreground size-8'
              />
            }
          >
            {flowSensitiveVisible ? <Eye /> : <EyeOff />}
          </TooltipTrigger>
          <TooltipContent>
            {flowSensitiveVisible
              ? t('Hide sensitive data')
              : t('Show sensitive data')}
          </TooltipContent>
        </Tooltip>
        <ModelsFilter
          preferences={chartPreferences}
          currentFilters={modelFilters}
          onFilterChange={handleFilterChange}
          onReset={handleResetFilters}
          maxRangeDays={isAdmin ? undefined : 30}
          titleKey='Flow Filters'
          descriptionKey='Filter the traffic flow view by time range and user.'
        />
        <AutoRefreshControl
          autoRefreshInterval={autoRefreshInterval}
          onAutoRefreshIntervalChange={setAutoRefreshInterval}
        />
      </>
    ) : null
  const sectionActions = modelActions ?? flowActions ?? userActions

  if (activeSection === 'overview') {
    return <OverviewDashboard />
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{pageTitle}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='w-full min-w-0 space-y-3 sm:space-y-4'>
          <div className='flex flex-wrap items-center justify-between gap-1.5 sm:gap-2'>
            {showSectionTabs ? (
              <Tabs value={activeSection} onValueChange={handleSectionChange}>
                <TabsList
                  variant='line'
                  className='max-w-full flex-wrap justify-start gap-x-3 group-data-horizontal/tabs:h-auto'
                >
                  {visibleSections.map((section) => (
                    <TabsTrigger
                      key={section}
                      value={section}
                      className='flex-none px-0.5 text-[0.95rem]'
                    >
                      {section === 'models' && !isAdmin
                        ? t('Usage Analytics')
                        : t(SECTION_META[section].titleKey)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : (
              <div />
            )}
            {sectionActions != null && (
              <div className='flex max-w-full min-w-0 flex-wrap items-center gap-1.5 sm:gap-2'>
                {sectionActions}
              </div>
            )}
          </div>
          {activeSection === 'models' && (
            <FadeIn>
              <Suspense fallback={<ModelChartsFallback />}>
                <LazyModelDashboard
                  isAdmin={isAdmin}
                  filters={modelFilters}
                  preferences={chartPreferences}
                  onFilterChange={handleFilterChange}
                  refetchInterval={refetchInterval}
                />
              </Suspense>
            </FadeIn>
          )}
          {activeSection === 'users' && (
            <div className='flex min-w-0 flex-col gap-4'>
              <OperationsStrip range={sharedRange} />
              <FadeIn>
                <Suspense fallback={<ModelChartsFallback />}>
                  <LazyUserCharts
                    filters={userChartsFilters}
                    onFiltersChange={handleUserFiltersChange}
                    refetchInterval={refetchInterval}
                  />
                </Suspense>
              </FadeIn>
            </div>
          )}
          {activeSection === 'flow' && (
            <FadeIn>
              <Suspense fallback={<ModelChartsFallback />}>
                <LazyFlowCharts
                  filters={modelFilters}
                  sensitiveVisible={flowSensitiveVisible}
                  refetchInterval={refetchInterval}
                />
              </Suspense>
            </FadeIn>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
