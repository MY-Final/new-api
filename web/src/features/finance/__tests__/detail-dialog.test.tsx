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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { Row } from '@tanstack/react-table'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'

import { FinanceDetailDialog } from '../components/finance-detail-dialog'
import { FinanceRowActions } from '../components/finance-row-actions'
import type { FinanceRecord, FinancialOperation } from '../types'

vi.mock('../api', () => ({
  completeFinanceTopup: vi.fn(),
}))

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en } })

const penalty: FinancialOperation = {
  id: 42,
  operation_type: 'penalty',
  operation_key: 'penalty:req-1',
  reversal_of_id: 0,
  reversed_by_id: 43,
  operator_id: 1,
  operator_username: 'root',
  target_user_id: 7,
  target_username: 'bob',
  related_user_id: 0,
  related_username: '',
  source_type: 'user',
  source_id: '7',
  principal_quota: 500_000,
  rebate_quota: 0,
  target_main_delta: -500_000,
  related_main_delta: 0,
  related_affiliate_delta: 0,
  target_main_before: 1_500_000,
  target_main_after: 1_000_000,
  target_bonus_delta: 0,
  target_paid_delta: -500_000,
  related_main_before: 0,
  related_main_after: 0,
  related_affiliate_before: 0,
  related_affiliate_after: 0,
  reason: 'abuse correction',
  created_at: 1_760_000_000,
} as unknown as FinancialOperation

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('shows the audit snapshot of an operation, including its reversal link', () => {
  render(
    <I18nextProvider i18n={i18n}>
      <FinanceDetailDialog
        section='operations'
        item={penalty}
        onClose={() => undefined}
      />
    </I18nextProvider>
  )

  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText('abuse correction')).toBeInTheDocument()
  expect(screen.getByText('penalty:req-1')).toBeInTheDocument()
  // Balance transition plus the reversal linkage are the point of the drill-down.
  expect(screen.getByText('1,500,000 → 1,000,000')).toBeInTheDocument()
  expect(screen.getByText('#43')).toBeInTheDocument()
})

it('offers details for every row but not a second reversal for a reversed penalty', async () => {
  const user = userEvent.setup()
  const row = { original: penalty } as Row<FinanceRecord>
  render(
    <I18nextProvider i18n={i18n}>
      <FinanceRowActions
        section='operations'
        row={row}
        onAction={() => undefined}
        onRefresh={() => undefined}
        onDetails={() => undefined}
      />
    </I18nextProvider>
  )

  await user.click(screen.getByRole('button', { name: 'Open menu' }))

  expect(screen.getByRole('menuitem', { name: /Details/ })).toBeInTheDocument()
  expect(
    screen.queryByRole('menuitem', { name: /Reverse penalty/ })
  ).not.toBeInTheDocument()
})

it('still offers the reversal for a penalty that was not reversed', async () => {
  const user = userEvent.setup()
  const fresh = { ...penalty, reversed_by_id: 0 } as FinancialOperation
  const row = { original: fresh } as Row<FinanceRecord>
  render(
    <I18nextProvider i18n={i18n}>
      <FinanceRowActions
        section='operations'
        row={row}
        onAction={() => undefined}
        onRefresh={() => undefined}
        onDetails={() => undefined}
      />
    </I18nextProvider>
  )

  await user.click(screen.getByRole('button', { name: 'Open menu' }))

  expect(
    screen.getByRole('menuitem', { name: /Reverse penalty/ })
  ).toBeInTheDocument()
})
