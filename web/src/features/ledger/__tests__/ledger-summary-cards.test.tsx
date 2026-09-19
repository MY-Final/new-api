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
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { LedgerSummaryCards } from '../components/ledger-summary-cards'
import type { QuotaLedgerSummary } from '../types'

const summary: QuotaLedgerSummary = {
  total_consumed_quota: 1_000_000,
  remaining_quota: 500_000,
  remaining_bonus_quota: 200_000,
  remaining_paid_quota: 300_000,
  range_quota: 150_000,
  range_bonus_quota: 50_000,
  range_paid_quota: 100_000,
  debt_users: 2,
  debt_quota: -20_000,
  today_checkin_bonus: 10_000,
  today_checkin_users: 3,
}

describe('LedgerSummaryCards', () => {
  test('renders site-level consumption and balance cards', () => {
    render(
      <LedgerSummaryCards summary={summary} loading={false} error={false} />
    )

    expect(screen.getByText('Total consumed')).toBeInTheDocument()
    expect(
      screen.getByText('Consumption in selected period')
    ).toBeInTheDocument()
    expect(screen.getByText('Remaining quota')).toBeInTheDocument()
    expect(screen.getByText('Remaining welfare quota')).toBeInTheDocument()
    expect(screen.getByText('Remaining paid quota')).toBeInTheDocument()
    expect(screen.getByText('Debt users')).toBeInTheDocument()
    expect(
      screen.getByText('Check-in welfare issued today')
    ).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3 user(s) checked in today')).toBeInTheDocument()
  })

  test('shows placeholder values when the summary request failed', () => {
    render(<LedgerSummaryCards loading={false} error />)

    expect(screen.getAllByText('--').length).toBeGreaterThan(0)
  })
})
