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
import { createInstance } from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'

import { getFinancialOperations, getFinanceTopups } from '../api'
import { ExportTooLargeError, MAX_EXPORT_ROWS, exportFinanceCsv } from '../lib/export'
import type { FinanceFilters, FinanceTopup, FinancialOperation } from '../types'

vi.mock('../api', () => ({
  getFinanceTopups: vi.fn(),
  getFinanceRedemptions: vi.fn(),
  getFinanceRebates: vi.fn(),
  getFinancialOperations: vi.fn(),
}))

vi.mock('@/lib/csv', () => ({
  downloadCsv: vi.fn(),
}))

const { downloadCsv } = await import('@/lib/csv')
const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en } })

const filters: FinanceFilters = { page: 1, pageSize: 20 }

function topup(id: number, amount: number): FinanceTopup {
  return {
    id,
    trade_no: `trade-${id}`,
    user_id: 7,
    username: 'alice',
    status: 'success',
    credited_quota: amount,
    rebate_quota: 0,
    create_time: 1_760_000_000,
    payment_provider: 'epay',
  } as FinanceTopup
}

afterEach(() => {
  // mockReset also drops queued mockResolvedValueOnce values, so a leftover
  // queue cannot leak into the next case.
  vi.mocked(getFinanceTopups).mockReset()
  vi.mocked(getFinancialOperations).mockReset()
  vi.mocked(downloadCsv).mockReset()
})

it('walks every page of the filtered rows and exports the table labels', async () => {
  vi.mocked(getFinanceTopups).mockImplementation(async (page) => ({
    items: [topup(page.page, page.page * 5)],
    total: 250,
  }))

  const exported = await exportFinanceCsv('topups', filters, i18n.t)

  expect(exported).toBe(3)
  expect(getFinanceTopups).toHaveBeenCalledTimes(3)
  // The export ignores the table's current pagination and uses its own, so the
  // file always contains the whole filtered range.
  expect(vi.mocked(getFinanceTopups).mock.calls.map((call) => call[0].page)).toEqual([
    1, 2, 3,
  ])
  expect(vi.mocked(getFinanceTopups).mock.calls[1][0]).toMatchObject({
    pageSize: 100,
  })

  const [filename, rows] = vi.mocked(downloadCsv).mock.calls[0]
  expect(String(filename)).toMatch(/^finance-topups-\d{4}-\d{2}-\d{2}T/)
  expect(rows[0]).toEqual([
    'Order number',
    'User',
    'Amount',
    'Rebate',
    'Provider',
    'Status',
    'Time',
    'Reason',
  ])
  expect(rows).toHaveLength(4)
})

it('refuses a range that is larger than the export cap instead of truncating it', async () => {
  vi.mocked(getFinanceTopups).mockResolvedValueOnce({
    items: [topup(1, 5)],
    total: MAX_EXPORT_ROWS + 1,
  })

  await expect(exportFinanceCsv('topups', filters, i18n.t)).rejects.toThrow(
    ExportTooLargeError
  )
  expect(downloadCsv).not.toHaveBeenCalled()
})

it('exports operations with the operator and target columns', async () => {
  const operation = {
    id: 9,
    operation_type: 'penalty',
    operation_key: 'penalty:r1',
    operator_username: 'root',
    target_username: 'bob',
    related_username: '',
    principal_quota: 8,
    rebate_quota: 0,
    reason: 'abuse',
    source_id: '12',
    created_at: 1_760_000_000,
  } as unknown as FinancialOperation
  vi.mocked(getFinancialOperations).mockResolvedValueOnce({
    items: [operation],
    total: 1,
  })

  await exportFinanceCsv('operations', filters, i18n.t)

  const rows = vi.mocked(downloadCsv).mock.calls[0][1]
  expect(rows[0]).toContain('Operator')
  expect(rows[0]).toContain('Target')
  expect(rows[1][1]).toBe('root')
  expect(rows[1][2]).toBe('bob')
})
