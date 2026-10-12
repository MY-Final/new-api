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
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatCompactNumber,
  formatNumber,
  formatPercent,
  formatQuota,
} from '@/lib/format'
import { buildLogsDrilldownSearch } from '@/lib/logs-drilldown'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { MODEL_RANKING_OPTIONS } from '../../constants'
import type {
  DashboardFilters,
  DashboardMetric,
  DashboardModelStats,
} from '../../types'
import { PanelWrapper } from '../ui/panel-wrapper'

interface ModelChartsProps {
  data: DashboardModelStats[]
  loading: boolean
  defaultMetric: DashboardMetric
  filters: DashboardFilters
  title?: string
}

export function ModelCharts(props: ModelChartsProps) {
  useSystemConfigStore((state) => state.config.currency)
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [metric, setMetric] = useState<DashboardMetric>(props.defaultMetric)
  const models = useMemo(
    () =>
      [...props.data].sort(
        (a, b) => b[metric] - a[metric] || a.model.localeCompare(b.model)
      ),
    [props.data, metric]
  )
  const total = props.data.reduce((sum, item) => sum + item[metric], 0)
  const [expanded, setExpanded] = useState(false)
  const visibleModels = expanded ? models : models.slice(0, 5)

  return (
    <PanelWrapper
      title={props.title ?? t('Model Ranking')}
      description={t('Share of the selected metric')}
      loading={props.loading}
      empty={!props.data.length}
      emptyMessage={t('No usage data')}
      height='h-64'
      className='h-full rounded-xl shadow-none'
      headerActions={
        <Tabs
          className='max-w-full'
          value={metric}
          onValueChange={(value) => setMetric(value as DashboardMetric)}
        >
          <TabsList
            className='max-w-full flex-wrap group-data-horizontal/tabs:h-auto'
            aria-label={t('Model ranking metric')}
          >
            {MODEL_RANKING_OPTIONS.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {t(option.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      <div className='flex flex-col gap-4'>
        {visibleModels.map((model) => {
          const share = total > 0 ? (model[metric] / total) * 100 : 0
          const display =
            metric === 'quota'
              ? formatQuota(model[metric])
              : formatCompactNumber(model[metric], locale)
          return (
            <div key={model.model} className='min-w-0'>
              <div className='mb-2 flex items-center justify-between gap-3'>
                {model.model &&
                props.filters.start_timestamp &&
                props.filters.end_timestamp ? (
                  <Link
                    className={cn(
                      buttonVariants({ variant: 'link' }),
                      'h-auto min-w-0 shrink justify-start p-0'
                    )}
                    to='/usage-logs/$section'
                    params={{ section: 'common' }}
                    search={buildLogsDrilldownSearch({
                      start: props.filters.start_timestamp,
                      end: props.filters.end_timestamp,
                      model: model.model,
                      username: props.filters.username,
                    })}
                  >
                    <span
                      className='truncate font-mono text-xs'
                      title={model.model}
                    >
                      {model.model}
                    </span>
                  </Link>
                ) : (
                  <span className='min-w-0 truncate font-mono text-xs'>
                    {model.model || t('Unknown')}
                  </span>
                )}
                <span
                  className='shrink-0 text-right text-xs tabular-nums'
                  title={
                    metric === 'quota'
                      ? formatQuota(model[metric])
                      : formatNumber(model[metric], locale)
                  }
                >
                  {display}
                  <span className='text-muted-foreground ml-2'>
                    {formatPercent(share)}
                  </span>
                </span>
              </div>
              <Progress
                value={Math.min(100, Math.max(0, share))}
                aria-label={model.model || t('Unknown')}
                className='gap-0'
              />
            </div>
          )
        })}
        {models.length > 5 && (
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? t('Show less') : t('View all models')}
          </Button>
        )}
      </div>
    </PanelWrapper>
  )
}
