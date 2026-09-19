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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { FadeIn } from '@/components/page-transition'
import { ModelsFilter } from '@/features/dashboard/components/models/models-filter-dialog'
import {
  buildDefaultDashboardFilters,
  getSavedChartPreferences,
} from '@/features/dashboard/lib'
import type { DashboardFilters } from '@/features/dashboard/types'
import { AutoRefreshControl } from '@/features/usage-logs/components/auto-refresh-control'
import {
  DASHBOARD_AUTO_REFRESH_STORAGE_KEY,
  useAutoRefreshInterval,
} from '@/hooks'

import { ReliabilityPanel } from './components/reliability-panel'

export function Monitoring() {
  const { t } = useTranslation()
  const [preferences] = useState(() => getSavedChartPreferences())
  const [filters, setFilters] = useState<DashboardFilters>(() =>
    buildDefaultDashboardFilters(getSavedChartPreferences())
  )
  const { autoRefreshInterval, setAutoRefreshInterval } =
    useAutoRefreshInterval(DASHBOARD_AUTO_REFRESH_STORAGE_KEY)
  const refetchInterval =
    autoRefreshInterval > 0 ? autoRefreshInterval : (false as const)

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Operations Monitoring')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <ModelsFilter
          preferences={preferences}
          currentFilters={filters}
          onFilterChange={setFilters}
          onReset={() => setFilters(buildDefaultDashboardFilters(preferences))}
          titleKey='Monitoring Filters'
          descriptionKey='Filter the monitoring view by time range and user.'
          showGranularity={false}
        />
        <AutoRefreshControl
          autoRefreshInterval={autoRefreshInterval}
          onAutoRefreshIntervalChange={setAutoRefreshInterval}
        />
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <FadeIn>
          <ReliabilityPanel
            filters={filters}
            refetchInterval={refetchInterval}
          />
        </FadeIn>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
