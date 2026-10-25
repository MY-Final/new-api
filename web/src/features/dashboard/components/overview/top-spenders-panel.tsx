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
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatPercent, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { useTopSpenders } from '../../hooks/use-top-spenders'
import { PanelWrapper } from '../ui/panel-wrapper'

interface TopSpendersPanelProps {
  range: { start: Date; end: Date }
}

export function TopSpendersPanel(props: TopSpendersPanelProps) {
  const { t } = useTranslation()
  // Subscribe so quota amounts re-render when the display currency changes.
  useSystemConfigStore((state) => state.config.currency)
  const spenderQuery = useTopSpenders(props.range)
  const items = spenderQuery.data?.items ?? []
  const total = spenderQuery.data?.summary.user_cost ?? 0

  return (
    <PanelWrapper
      title={t('Top spenders')}
      description={t('Highest spend in the selected period')}
      loading={spenderQuery.loading}
      empty={!spenderQuery.error && items.length === 0}
      emptyMessage={t('No usage data')}
      height='h-64'
      className='h-full rounded-xl shadow-none'
      headerActions={
        <Link
          to='/usage'
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {t('View full ranking')}
        </Link>
      }
    >
      {spenderQuery.error ? (
        <ErrorState
          title={t('Failed to load statistics')}
          onRetry={() => void spenderQuery.refetch()}
          className='min-h-48'
        />
      ) : (
        <>
          <ol className='flex flex-col gap-1'>
            {items.map((item, index) => {
              const name = item.username || `#${item.user_id}`
              const share =
                total > 0 ? (item.user_cost / total) * 100 : undefined

              return (
                <li
                  key={item.user_id}
                  className='flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5'
                >
                  <span
                    className={cn(
                      'bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums',
                      index < 3 && 'bg-primary/10 text-primary'
                    )}
                    aria-hidden='true'
                  >
                    {index + 1}
                  </span>
                  <span
                    className='min-w-0 flex-1 truncate text-xs'
                    title={name}
                  >
                    {name}
                  </span>
                  <Progress
                    value={Math.min(100, Math.max(0, share ?? 0))}
                    aria-label={name}
                    aria-valuetext={
                      share === undefined ? '—' : formatPercent(share)
                    }
                    className='hidden w-16 shrink-0 gap-0 sm:flex'
                  />
                  <span className='text-muted-foreground shrink-0 font-mono text-xs tabular-nums'>
                    {formatQuota(item.user_cost)}
                  </span>
                </li>
              )
            })}
          </ol>
          <div className='text-muted-foreground mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs'>
            <span>{t('Total consumed')}</span>
            <span className='text-foreground font-mono font-medium tabular-nums'>
              {formatQuota(total)}
            </span>
          </div>
        </>
      )}
    </PanelWrapper>
  )
}
