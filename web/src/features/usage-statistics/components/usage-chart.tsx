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
import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber, formatQuota } from '@/lib/format'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'

import type { UserUsage } from '../types'

const LazyVChart = lazy(() =>
  import('@visactor/react-vchart').then((module) => ({
    default: module.VChart,
  }))
)

type UsageChartMetric = 'tokens' | 'cost' | 'requests'

interface UsageChartProps {
  data: UserUsage['daily']
  metric: UsageChartMetric
  title: string
  color: string
}

export function UsageChart(props: UsageChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const chartData = useMemo(
    () =>
      props.data.map((item) => {
        let value = item.request_count
        if (props.metric === 'tokens') value = item.total_tokens
        if (props.metric === 'cost') value = item.user_cost
        return { day: item.day, value }
      }),
    [props.data, props.metric]
  )

  const spec = useMemo(() => {
    if (chartData.length === 0) return null
    return {
      type: 'line' as const,
      data: [{ id: props.metric, values: chartData }],
      xField: 'day',
      yField: 'value',
      color: [props.color],
      point: { visible: true, style: { size: 4 } },
      line: { style: { lineWidth: 2 } },
      legends: { visible: false },
      tooltip: {
        mark: {
          title: { value: (datum: { day: string }) => datum.day },
          content: [
            {
              key: props.title,
              value: (datum: { value: number }) => {
                if (props.metric === 'cost') return formatQuota(datum.value)
                return formatNumber(datum.value)
              },
            },
          ],
        },
      },
      axes: [
        {
          orient: 'bottom' as const,
          label: { style: { fontSize: 10 } },
          tick: { visible: false },
        },
        {
          orient: 'left' as const,
          label: {
            formatMethod: (value: number | string) =>
              props.metric === 'cost'
                ? formatQuota(Number(value))
                : formatNumber(Number(value)),
          },
          grid: { visible: true },
        },
      ],
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      background: 'transparent',
    }
  }, [chartData, props.color, props.metric, props.title, resolvedTheme])

  let content: ReactNode
  if (chartData.length === 0) {
    content = (
      <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
        {t('No usage data')}
      </div>
    )
  } else if (!themeReady || !spec) {
    content = <Skeleton className='h-full w-full' />
  } else {
    content = (
      <Suspense fallback={<Skeleton className='h-full w-full' />}>
        <LazyVChart spec={spec} option={VCHART_OPTION} />
      </Suspense>
    )
  }

  return (
    <section className='overflow-hidden rounded-lg border'>
      <div className='border-b px-3 py-2 text-sm font-medium'>
        {props.title}
      </div>
      <div className='h-52 p-1.5 sm:h-60 sm:p-2'>{content}</div>
    </section>
  )
}
