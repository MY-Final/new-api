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
import type { Row } from '@tanstack/react-table'
import { Check, Info, RotateCcw, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
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
  onDetails: (item: FinanceRecord) => void
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

  // Every row can be inspected; the mutating actions depend on the section and
  // on the row's own state.
  const items: ReactNode[] = [
    <DropdownMenuItem key='details' onClick={() => props.onDetails(item)}>
      {t('Details')}
      <DropdownMenuShortcut>
        <Info size={16} />
      </DropdownMenuShortcut>
    </DropdownMenuItem>,
  ]

  if (props.section === 'topups') {
    const topup = item as FinanceTopup
    if (topup.status === 'pending') {
      items.push(
        <DropdownMenuItem
          key='complete'
          onClick={() => completeTopup(topup.trade_no)}
        >
          {t('Complete')}
          <DropdownMenuShortcut>
            <Check size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      )
    }
    if (topup.status === 'success' && topup.source !== 'subscription') {
      items.push(
        <DropdownMenuItem
          key='refund'
          className='text-destructive focus:text-destructive'
          onClick={() => props.onAction({ kind: 'topup-refund', item: topup })}
        >
          {t('Refund top-up')}
          <DropdownMenuShortcut>
            <Undo2 size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      )
    }
  } else if (props.section === 'redemptions') {
    const redemption = item as FinanceRedemption
    if (redemption.status === 3 && redemption.type === 'paid') {
      items.push(
        <DropdownMenuItem
          key='refund'
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
      )
    }
  } else if (props.section === 'rebates') {
    const rebate = item as FinanceRebate
    if (rebate.status !== 'reversed' && rebate.source_type !== 'signup') {
      items.push(
        <DropdownMenuItem
          key='reverse'
          className='text-destructive focus:text-destructive'
          onClick={() => props.onAction({ kind: 'rebate-reverse', item: rebate })}
        >
          {t('Reverse rebate')}
          <DropdownMenuShortcut>
            <RotateCcw size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      )
    }
  } else {
    const operation = item as FinancialOperation
    // A reversed penalty keeps its reversal link, so the action is not offered
    // again; the backend would only answer "already reversed".
    if (operation.operation_type === 'penalty' && !operation.reversed_by_id) {
      items.push(
        <DropdownMenuItem
          key='reverse'
          onClick={() =>
            props.onAction({ kind: 'penalty-reverse', item: operation })
          }
        >
          {t('Reverse penalty')}
          <DropdownMenuShortcut>
            <RotateCcw size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      )
    }
  }

  return (
    <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
      {items}
    </DataTableRowActionMenu>
  )
}
