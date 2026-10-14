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
import type { TFunction } from 'i18next'

import { formatQuota, formatTimestamp } from '@/lib/format'
import { downloadCsv, type CsvValue } from '@/lib/csv'

import {
  getFinancialOperations,
  getFinanceRebates,
  getFinanceRedemptions,
  getFinanceTopups,
} from '../api'
import {
  getCodeTypeLabel,
  getOperationTypeLabel,
  getProviderLabel,
  getSourceLabel,
  getStatusLabel,
} from './labels'
import type {
  FinanceFilters,
  FinanceRebate,
  FinanceRecord,
  FinanceRedemption,
  FinanceSection,
  FinanceTopup,
  FinancialOperation,
  PageData,
} from '../types'

/** Rows fetched per request while walking the filtered result set. */
const EXPORT_PAGE_SIZE = 100
/**
 * Upper bound for one export. Finance exports are meant to answer "what
 * happened in this period", so a range wider than this should be narrowed
 * instead of streaming a huge file through the browser.
 */
export const MAX_EXPORT_ROWS = 5000

type ExportColumn = {
  header: string
  value: (item: never, t: TFunction) => CsvValue
}

export class ExportTooLargeError extends Error {
  constructor(readonly total: number) {
    super(`export limited to ${MAX_EXPORT_ROWS} rows`)
    this.name = 'ExportTooLargeError'
  }
}

function fetchPage(
  section: FinanceSection,
  filters: FinanceFilters,
  page: number
): Promise<PageData<FinanceRecord>> {
  const pageFilters = { ...filters, page, pageSize: EXPORT_PAGE_SIZE }
  if (section === 'topups') {
    return getFinanceTopups(pageFilters) as Promise<PageData<FinanceRecord>>
  }
  if (section === 'redemptions') {
    return getFinanceRedemptions(pageFilters) as Promise<PageData<FinanceRecord>>
  }
  if (section === 'rebates') {
    return getFinanceRebates(pageFilters) as Promise<PageData<FinanceRecord>>
  }
  return getFinancialOperations(pageFilters) as Promise<PageData<FinanceRecord>>
}

function columnsFor(section: FinanceSection, t: TFunction): ExportColumn[] {
  if (section === 'topups') {
    return [
      { header: t('Order number'), value: (row: FinanceTopup) => row.trade_no },
      { header: t('User'), value: (row: FinanceTopup) => row.username ?? '' },
      {
        header: t('Amount'),
        value: (row: FinanceTopup) => formatQuota(row.credited_quota ?? 0),
      },
      {
        header: t('Rebate'),
        value: (row: FinanceTopup) => formatQuota(row.rebate_quota ?? 0),
      },
      {
        header: t('Provider'),
        value: (row: FinanceTopup) => getProviderLabel(row.payment_provider ?? '', t),
      },
      {
        header: t('Status'),
        value: (row: FinanceTopup) => getStatusLabel(row.status, t),
      },
      { header: t('Time'), value: (row: FinanceTopup) => formatTimestamp(row.create_time) },
      {
        header: t('Reason'),
        value: (row: FinanceTopup) => row.refund_reason ?? '',
      },
    ]
  }
  if (section === 'redemptions') {
    return [
      { header: t('ID'), value: (row: FinanceRedemption) => row.id },
      {
        header: t('Redemption code'),
        value: (row: FinanceRedemption) => row.key,
      },
      {
        header: t('Type'),
        value: (row: FinanceRedemption) => getCodeTypeLabel(row.type, t),
      },
      {
        header: t('Amount'),
        value: (row: FinanceRedemption) => formatQuota(row.quota),
      },
      {
        header: t('Status'),
        value: (row: FinanceRedemption) => getStatusLabel(String(row.status), t),
      },
      {
        header: t('Used by'),
        value: (row: FinanceRedemption) => row.used_username ?? '',
      },
      {
        header: t('Redeemed at'),
        value: (row: FinanceRedemption) =>
          row.redeemed_time ? formatTimestamp(row.redeemed_time) : '',
      },
      {
        header: t('Reason'),
        value: (row: FinanceRedemption) => row.refund_reason ?? '',
      },
    ]
  }
  if (section === 'rebates') {
    return [
      {
        header: t('Inviter'),
        value: (row: FinanceRebate) => row.inviter_username ?? row.inviter_id,
      },
      {
        header: t('Invitee'),
        value: (row: FinanceRebate) => row.invitee_username ?? row.invitee_id,
      },
      {
        header: t('Source'),
        value: (row: FinanceRebate) => getSourceLabel(row.source_type, t),
      },
      {
        header: t('Base quota'),
        value: (row: FinanceRebate) => formatQuota(row.base_quota),
      },
      {
        header: t('Rebate'),
        value: (row: FinanceRebate) => formatQuota(row.rebate_quota),
      },
      {
        header: t('Reversed'),
        value: (row: FinanceRebate) => formatQuota(row.reversed_quota),
      },
      {
        header: t('Status'),
        value: (row: FinanceRebate) => getStatusLabel(row.status, t),
      },
      {
        header: t('Time'),
        value: (row: FinanceRebate) => formatTimestamp(row.created_at),
      },
    ]
  }
  return [
    {
      header: t('Operation type'),
      value: (row: FinancialOperation) =>
        getOperationTypeLabel(row.operation_type, t),
    },
    {
      header: t('Operator'),
      value: (row: FinancialOperation) => row.operator_username,
    },
    {
      header: t('Target'),
      value: (row: FinancialOperation) => row.target_username,
    },
    {
      header: t('Related user'),
      value: (row: FinancialOperation) => row.related_username ?? '',
    },
    {
      header: t('Amount'),
      value: (row: FinancialOperation) => formatQuota(row.principal_quota),
    },
    {
      header: t('Rebate'),
      value: (row: FinancialOperation) => formatQuota(row.rebate_quota),
    },
    { header: t('Reason'), value: (row: FinancialOperation) => row.reason },
    {
      header: t('Source'),
      value: (row: FinancialOperation) => row.source_id,
    },
    {
      header: t('Time'),
      value: (row: FinancialOperation) => formatTimestamp(row.created_at),
    },
  ]
}

/** Filename-safe timestamp for the downloaded file. */
function exportStamp(): string {
  return new Date().toISOString().slice(0, 19).replaceAll(':', '-')
}

/**
 * Exports the rows matching the current filters as CSV.
 *
 * The console has no export endpoint, so this walks the same paginated API the
 * table uses: the file therefore contains exactly the filtered rows with the
 * labels the administrator sees, in their own language. Ranges that would need
 * more than {@link MAX_EXPORT_ROWS} rows throw an {@link ExportTooLargeError}
 * so the UI can ask for a narrower filter instead of silently truncating.
 */
export async function exportFinanceCsv(
  section: FinanceSection,
  filters: FinanceFilters,
  t: TFunction
): Promise<number> {
  const columns = columnsFor(section, t)
  const first = await fetchPage(section, filters, 1)
  if (first.total > MAX_EXPORT_ROWS) {
    throw new ExportTooLargeError(first.total)
  }

  const rows: CsvValue[][] = [columns.map((column) => column.header)]
  const appendRows = (items: FinanceRecord[]) => {
    for (const item of items) {
      rows.push(columns.map((column) => column.value(item as never, t)))
    }
  }
  appendRows(first.items)

  const pageCount = Math.ceil(first.total / EXPORT_PAGE_SIZE)
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await fetchPage(section, filters, page)
    appendRows(next.items)
  }

  downloadCsv(`finance-${section}-${exportStamp()}.csv`, rows)
  return rows.length - 1
}
