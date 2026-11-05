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
import { formatQuota } from '@/lib/format'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'

import type { SubscriptionUsageDaily } from '../types'

const LazyVChart = lazy(() =>
  import('@visactor/react-vchart').then((module) => ({
    default: module.VChart,
  }))
)

interface SubscriptionUsageChartProps {
  data: SubscriptionUsageDaily[]
}

export function SubscriptionUsageChart(props: SubscriptionUsageChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const chartData = useMemo(
    () =>
      props.data.flatMap((item) => [
        {
          date: item.date,
          series: t('Wallet'),
          value: item.wallet_quota,
        },
        {
          date: item.date,
          series: t('Subscription'),
          value: item.subscription_quota,
        },
      ]),
    [props.data, t]
  )
  const hasUsage = useMemo(
    () => props.data.some((item) => item.quota > 0),
    [props.data]
  )

  const spec = useMemo(() => {
    if (!hasUsage) return null
    return {
      type: 'bar' as const,
      data: [{ id: 'subscriptionUsage', values: chartData }],
      xField: 'date',
      yField: 'value',
      seriesField: 'series',
      stack: true,
      color: ['#2563eb', '#c2410c'],
      legends: {
        visible: true,
        orient: 'top' as const,
        position: 'end' as const,
      },
      tooltip: {
        trigger: 'hover' as const,
        mark: {
          title: {
            value: (datum?: { date?: string }) => datum?.date ?? '',
          },
          content: [
            {
              key: (datum?: { series?: string }) => datum?.series ?? '',
              value: (datum?: { value?: number }) =>
                formatQuota(Number(datum?.value) || 0),
            },
          ],
        },
      },
      axes: [
        {
          orient: 'bottom' as const,
          label: {
            style: { fontSize: 10 },
            formatMethod: (value: string) => value.slice(5),
          },
          tick: { visible: false },
        },
        {
          orient: 'left' as const,
          label: {
            formatMethod: (value: number | string) =>
              formatQuota(Number(value)),
          },
          grid: { visible: true },
        },
      ],
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      background: 'transparent',
    }
  }, [chartData, hasUsage, resolvedTheme])

  let content: ReactNode
  if (!hasUsage) {
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

  return <div className='h-60 p-1.5 sm:h-72 sm:p-2'>{content}</div>
}
