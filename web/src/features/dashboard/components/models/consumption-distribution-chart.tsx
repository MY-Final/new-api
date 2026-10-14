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
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { formatChartTime, type TimeGranularity } from '@/lib/time'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { MODEL_RANKING_OPTIONS } from '../../constants'
import type {
  ConsumptionDistributionChartType,
  DashboardAnalytics,
  DashboardMetric,
} from '../../types'
import { PanelWrapper } from '../ui/panel-wrapper'

interface ConsumptionDistributionChartProps {
  data: DashboardAnalytics
  loading: boolean
  defaultChartType: ConsumptionDistributionChartType
  timeGranularity: TimeGranularity
}

export function ConsumptionDistributionChart(
  props: ConsumptionDistributionChartProps
) {
  useSystemConfigStore((state) => state.config.currency)
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [metric, setMetric] = useState<DashboardMetric>('quota')
  const label = t(
    MODEL_RANKING_OPTIONS.find((option) => option.value === metric)?.labelKey ??
      'Cost'
  )
  const total =
    metric === 'quota'
      ? formatQuota(props.data.summary[metric])
      : formatNumber(props.data.summary[metric], locale)
  const TrendChart = props.defaultChartType === 'bar' ? BarChart : AreaChart
  const bucketLabel = t(
    { hour: 'Hour', day: 'Day', week: 'Week' }[props.timeGranularity]
  )

  return (
    <PanelWrapper
      title={t('Consumption Trend')}
      description={`${t('Total')}: ${total} · ${bucketLabel}`}
      loading={props.loading}
      empty={props.data.models.length === 0}
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
            aria-label={t('Trend metric')}
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
      <ChartContainer
        className='h-64 w-full sm:h-72'
        aria-label={t('Consumption Trend')}
        config={{ [metric]: { label, color: 'var(--chart-1)' } }}
      >
        <TrendChart
          accessibilityLayer
          data={props.data.timeline}
          margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey='timestamp'
            tickFormatter={(value: number) =>
              formatChartTime(value, props.timeGranularity)
            }
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
              metric === 'quota'
                ? formatQuota(value)
                : formatCompactNumber(value, locale)
            }
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_value, payload) => {
                  const timestamp = payload?.[0]?.payload?.timestamp
                  return typeof timestamp === 'number'
                    ? formatChartTime(timestamp, props.timeGranularity)
                    : ''
                }}
                formatter={(value) => (
                  <span className='flex flex-1 justify-between gap-4'>
                    <span className='text-muted-foreground'>{label}</span>
                    <span className='font-mono font-medium'>
                      {metric === 'quota'
                        ? formatQuota(Number(value))
                        : formatNumber(Number(value), locale)}
                    </span>
                  </span>
                )}
              />
            }
          />
          {props.defaultChartType === 'bar' ? (
            <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={3} />
          ) : (
            <Area
              dataKey={metric}
              type='linear'
              fill={`var(--color-${metric})`}
              fillOpacity={0.12}
              stroke={`var(--color-${metric})`}
              strokeWidth={2}
            />
          )}
        </TrendChart>
      </ChartContainer>
    </PanelWrapper>
  )
}
