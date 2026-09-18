import type { Row } from '@tanstack/react-table'
import { Check, RotateCcw, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DataTableRowActionMenu } from '@/components/data-table'
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { handleServerError } from '@/lib/handle-server-error'

import { completeFinanceTopup } from '../api'
import type {
  FinanceAction,
  FinanceRebate,
  FinanceRecord,
  FinanceRedemption,
  FinanceSection,
  FinanceTopup,
  FinancialOperation,
} from '../types'

export function FinanceRowActions(props: {
  section: FinanceSection
  row: Row<FinanceRecord>
  onAction: (action: FinanceAction) => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const item = props.row.original

  const completeTopup = async (tradeNo: string) => {
    try {
      await completeFinanceTopup(tradeNo)
      props.onRefresh()
    } catch (error) {
      handleServerError(error)
    }
  }

  if (props.section === 'topups') {
    const topup = item as FinanceTopup
    const canComplete = topup.status === 'pending'
    const canRefund =
      topup.status === 'success' && topup.source !== 'subscription'
    if (!canComplete && !canRefund) return null
    return (
      <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
        {canComplete && (
          <DropdownMenuItem onClick={() => completeTopup(topup.trade_no)}>
            {t('Complete')}
            <DropdownMenuShortcut>
              <Check size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        {canRefund && (
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            onClick={() =>
              props.onAction({ kind: 'topup-refund', item: topup })
            }
          >
            {t('Refund top-up')}
            <DropdownMenuShortcut>
              <Undo2 size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DataTableRowActionMenu>
    )
  }

  if (props.section === 'redemptions') {
    const redemption = item as FinanceRedemption
    if (redemption.status !== 3 || redemption.type !== 'paid') return null
    return (
      <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
        <DropdownMenuItem
          className='text-destructive focus:text-destructive'
          onClick={() =>
            props.onAction({ kind: 'redemption-refund', item: redemption })
          }
        >
          {t('Refund redemption')}
          <DropdownMenuShortcut>
            <Undo2 size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DataTableRowActionMenu>
    )
  }

  if (props.section === 'rebates') {
    const rebate = item as FinanceRebate
    if (rebate.status === 'reversed' || rebate.source_type === 'signup') {
      return null
    }
    return (
      <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
        <DropdownMenuItem
          className='text-destructive focus:text-destructive'
          onClick={() =>
            props.onAction({ kind: 'rebate-reverse', item: rebate })
          }
        >
          {t('Reverse rebate')}
          <DropdownMenuShortcut>
            <RotateCcw size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DataTableRowActionMenu>
    )
  }

  const operation = item as FinancialOperation
  if (operation.operation_type !== 'penalty') return null
  return (
    <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
      <DropdownMenuItem
        onClick={() =>
          props.onAction({ kind: 'penalty-reverse', item: operation })
        }
      >
        {t('Reverse penalty')}
        <DropdownMenuShortcut>
          <RotateCcw size={16} />
        </DropdownMenuShortcut>
      </DropdownMenuItem>
    </DataTableRowActionMenu>
  )
}
