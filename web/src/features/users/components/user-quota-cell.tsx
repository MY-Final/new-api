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

import { QuotaDetailsPopover } from '@/components/quota-details-popover'
import { StatusBadge } from '@/components/status-badge'
import { Progress } from '@/components/ui/progress'
import { formatQuotaWithCurrency, getCurrencyDisplay } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

type UserQuotaCellProps = {
  remaining: number
  used: number
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

/**
 * Balance cell for the user list.
 *
 * Narrow table columns cannot fit four label/value pairs, so the cell keeps
 * three stacked rows — balance + used, the usage bar, and the paid/bonus
 * balances (which wrap instead of truncating). The full breakdown, including
 * how much each wallet source was consumed, opens on click so touch users do
 * not have to hover.
 */
export function UserQuotaCell(props: UserQuotaCellProps) {
  const { t } = useTranslation()
  // Subscribe so both the amounts and the unit follow currency setting changes.
  useSystemConfigStore((state) => state.config.currency)

  const { meta: currency } = getCurrencyDisplay()
  const quotaUnit = currency.kind === 'tokens' ? t('Tokens') : currency.symbol
  const total = props.used + props.remaining
  const hasQuota = props.remaining !== 0 || props.used !== 0
  // The per-source usage comes from the wallet ledger, which only exists for
  // accounts that consumed quota after it was introduced. Hide those rows when
  // the server sent nothing rather than implying both sources used zero.
  const hasSourceUsage =
    props.bonusUsed !== undefined || props.paidUsed !== undefined
  // A negative balance means the account overspent, so the bar bottoms out at
  // 0% instead of reporting a negative progressbar value.
  const percentage = total > 0 ? (props.remaining / total) * 100 : 0
  const clampedPercentage = Math.min(100, Math.max(0, percentage))
  // The unit lives in the column header, so cell values stay symbol-free and
  // narrow columns keep room for the number itself.
  const format = (value: number) =>
    formatQuotaWithCurrency(value, { showSymbol: false })

  const details = [
    { label: t('Available Balance'), value: format(props.remaining) },
    { label: t('Total Used'), value: format(props.used) },
    { label: t('Paid Balance'), value: format(props.paid ?? 0) },
    { label: t('Bonus Balance'), value: format(props.bonus ?? 0) },
    ...(hasSourceUsage
      ? [
          { label: t('Paid used'), value: format(props.paidUsed ?? 0) },
          { label: t('Bonus used'), value: format(props.bonusUsed ?? 0) },
        ]
      : []),
  ]

  return (
    <QuotaDetailsPopover
      title={`${t('Quota')} (${quotaUnit})`}
      triggerLabel={
        hasQuota
          ? `${t('Available Balance')} ${format(props.remaining)}; ${t('Used amount')} ${format(props.used)}`
          : t('No Quota')
      }
      details={details}
      className='w-full'
    >
      {hasQuota ? (
        <span className='grid w-full min-w-0 grid-cols-1 gap-y-1.5 text-sm tabular-nums'>
          <span className='flex min-w-0 items-baseline justify-between gap-2'>
            <span
              data-slot='user-quota-balance'
              className={cn(
                'min-w-0 truncate font-medium',
                props.remaining < 0 && 'text-destructive'
              )}
            >
              {format(props.remaining)}
            </span>
            <span
              data-table-text='secondary'
              className='text-muted-foreground flex min-w-0 items-baseline gap-1 text-xs font-normal'
            >
              <span>{t('Used amount')}</span>
              <span className='truncate'>{format(props.used)}</span>
            </span>
          </span>
          <Progress
            value={clampedPercentage}
            className={cn('h-1.5', getQuotaProgressColor(percentage))}
          />
          <span className='text-muted-foreground flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] leading-tight'>
            <span className='whitespace-nowrap'>
              <span>{t('Paid')}</span>{' '}
              <span className='text-foreground tabular-nums'>
                {format(props.paid ?? 0)}
              </span>
            </span>
            <span className='whitespace-nowrap'>
              <span>{t('Bonus')}</span>{' '}
              <span className='text-foreground tabular-nums'>
                {format(props.bonus ?? 0)}
              </span>
            </span>
          </span>
        </span>
      ) : (
        <StatusBadge
          label={t('No Quota')}
          variant='neutral'
          copyable={false}
          className='-ml-1.5 font-normal'
        />
      )}
    </QuotaDetailsPopover>
  )
}
