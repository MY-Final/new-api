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
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

type UserQuotaCellProps = {
  used: number
  remaining: number
  bonus?: number
  paid?: number
  bonusUsed?: number
  paidUsed?: number
}

function getQuotaProgressColor(percentage: number): string {
  if (percentage <= 10) return '[&_[data-slot=progress-indicator]]:bg-rose-500'
  if (percentage <= 30) return '[&_[data-slot=progress-indicator]]:bg-amber-500'
  return '[&_[data-slot=progress-indicator]]:bg-emerald-500'
}

export function UserQuotaCell(props: UserQuotaCellProps) {
  const { t } = useTranslation()
  const total = props.used + props.remaining
  // A negative balance means the account overspent, so the bar bottoms out at
  // 0% instead of reporting a negative progressbar value.
  const percentage = total > 0 ? (props.remaining / total) * 100 : 0
  const clampedPercentage = Math.min(100, Math.max(0, percentage))
  const formattedRemaining = formatQuota(props.remaining)
  const formattedTotal = formatQuota(total)
  const formattedUsed = formatQuota(props.used)
  // The per-source breakdown comes from the wallet ledger, which only exists
  // for accounts that consumed quota after it was introduced. Hide the row when
  // the server sent nothing rather than implying both sources used zero.
  const hasSourceUsage =
    props.bonusUsed !== undefined || props.paidUsed !== undefined

  if (total === 0) {
    return (
      <StatusBadge
        label={t('No Quota')}
        variant='neutral'
        copyable={false}
        className='-ml-1.5'
      />
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // tabIndex keeps the details reachable by keyboard: the trigger is a
          // plain div, so nothing would focus it otherwise.
          <div
            tabIndex={0}
            className='focus-visible:ring-ring/40 w-full min-w-0 cursor-help space-y-1.5 overflow-hidden rounded-sm focus-visible:ring-2 focus-visible:outline-none'
          />
        }
      >
        <div className='flex min-w-0 items-baseline justify-between gap-3 text-xs'>
          <span
            data-slot='user-quota-balance'
            className={cn(
              'min-w-0 truncate font-medium tabular-nums',
              props.remaining < 0 && 'text-destructive'
            )}
          >
            {formattedRemaining}
          </span>
          <span className='text-muted-foreground min-w-0 truncate text-right tabular-nums'>
            {t('Used amount')} {formattedUsed}
          </span>
        </div>
        <Progress
          value={clampedPercentage}
          className={cn('h-1.5', getQuotaProgressColor(percentage))}
        />
        <div className='text-muted-foreground grid min-w-0 grid-cols-2 gap-x-3 text-[11px] leading-tight'>
          <div className='flex min-w-0 items-baseline gap-1'>
            <span className='truncate'>{t('Paid Balance')}</span>
            <span className='text-foreground truncate tabular-nums'>
              {formatQuota(props.paid ?? 0)}
            </span>
          </div>
          <div className='flex min-w-0 items-baseline justify-end gap-1'>
            <span className='truncate'>{t('Bonus Balance')}</span>
            <span className='text-foreground truncate tabular-nums'>
              {formatQuota(props.bonus ?? 0)}
            </span>
          </div>
        </div>
        {hasSourceUsage && (
          <div className='text-muted-foreground grid min-w-0 grid-cols-2 gap-x-3 text-[11px] leading-tight'>
            <div className='flex min-w-0 items-baseline gap-1'>
              <span className='truncate'>{t('Paid used')}</span>
              <span className='text-foreground truncate tabular-nums'>
                {formatQuota(props.paidUsed ?? 0)}
              </span>
            </div>
            <div className='flex min-w-0 items-baseline justify-end gap-1'>
              <span className='truncate'>{t('Bonus used')}</span>
              <span className='text-foreground truncate tabular-nums'>
                {formatQuota(props.bonusUsed ?? 0)}
              </span>
            </div>
          </div>
        )}
      </TooltipTrigger>
      <TooltipContent>
        <div className='space-y-1 text-xs'>
          <div>
            {t('Used:')} {formattedUsed}
          </div>
          <div>
            {t('Remaining:')} {formattedRemaining}
          </div>
          <div>
            {t('Total:')} {formattedTotal}
          </div>
          <div>
            {t('Bonus Balance')}: {formatQuota(props.bonus ?? 0)}
          </div>
          <div>
            {t('Paid Balance')}: {formatQuota(props.paid ?? 0)}
          </div>
          {hasSourceUsage && (
            <>
              <div>
                {t('Bonus used')}: {formatQuota(props.bonusUsed ?? 0)}
              </div>
              <div>
                {t('Paid used')}: {formatQuota(props.paidUsed ?? 0)}
              </div>
            </>
          )}
          <div>
            {t('Percentage:')} {percentage.toFixed(1)}%
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
